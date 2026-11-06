// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title PolicyVault
/// @notice Holds funds for an autonomous AI agent and enforces spending policy.
///         In-policy payments settle immediately. Out-of-policy payments are
///         escalated and require the human owner (Ledger-signed) to release them.
///
/// Security patch (Nov 2026), addressing an external review of the ETHOnline 2026
/// showcase version:
///  1. FIXED DAILY WINDOW: the window is anchored to a fixed UTC grid
///     (dayStart == (block.timestamp / 1 days) * 1 days) and rolls over at the
///     top of every entry point that touches spentTodayUsdCents, including
///     releasePayment. A compromised agent can no longer time the reset itself,
///     and a released amount can no longer land in a window about to be wiped.
///  2. STALE FEED: latestRoundData().updatedAt is checked against
///     PRICE_STALENESS. A stale or invalid price escalates the payment
///     instead of approving it.
///  3. DUST: amounts that round below $0.01 escalate instead of counting as
///     zero toward both caps.
///  4. Hardening: escalation expiry, reentrancy guard, optional rate limit,
///     zero-address validation, rollover event, owner emergency sweep.
contract PolicyVault {
    address public owner;
    address public agent;
    AggregatorV3Interface public priceFeed;

    uint256 public dailyCapUsdCents;
    uint256 public perTxCapUsdCents;
    mapping(address => bool) public vendorAllowlist;

    uint256 public spentTodayUsdCents;
    /// @notice Start of the current fixed UTC day: (block.timestamp / 1 days) * 1 days.
    uint256 public dayStart;

    /// @dev Max age of a price round before it is treated as stale.
    ///      Tune to the heartbeat of the deployed Chainlink feed.
    uint256 public constant PRICE_STALENESS = 3 hours;
    /// @dev An escalated request must be released within this window.
    uint256 public constant ESCALATION_TTL = 2 days;
    /// @notice Minimum seconds between auto-approved payments (0 = disabled).
    ///         Covers the residual case of spending the full cap just before a
    ///         grid boundary and again just after, which any daily cap permits.
    uint256 public minPaymentInterval;

    uint256 private _lastApprovedAt;
    uint256 private _guard = 1;

    enum Status { None, Approved, Escalated, Rejected, Released }

    struct Payment {
        address vendor;
        uint256 amountWei;
        uint256 amountUsdCents;
        Status status;
        uint256 timestamp;
        string resource;
    }

    Payment[] public payments;

    event PaymentApproved(uint256 indexed id, address indexed vendor, uint256 amountWei, uint256 amountUsdCents, string resource);
    event PaymentEscalated(uint256 indexed id, address indexed vendor, uint256 amountWei, uint256 amountUsdCents, string resource, string reason);
    event PaymentRejected(uint256 indexed id, address indexed vendor, string reason);
    event PaymentReleased(uint256 indexed id, address indexed vendor, uint256 amountWei);
    event PolicyUpdated(uint256 dailyCapUsdCents, uint256 perTxCapUsdCents);
    event DayRollover(uint256 indexed day, uint256 spentBeforeResetUsdCents);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyAgent() { require(msg.sender == agent, "not agent"); _; }
    modifier nonReentrant() {
        require(_guard == 1, "reentrant call");
        _guard = 2;
        _;
        _guard = 1;
    }

    constructor(address _agent, address _priceFeed, uint256 _dailyCapUsdCents, uint256 _perTxCapUsdCents) {
        require(_agent != address(0), "zero agent");
        require(_priceFeed != address(0), "zero price feed");
        owner = msg.sender;
        agent = _agent;
        priceFeed = AggregatorV3Interface(_priceFeed);
        dailyCapUsdCents = _dailyCapUsdCents;
        perTxCapUsdCents = _perTxCapUsdCents;
        // Fixed grid anchor, not the deployment instant.
        dayStart = (block.timestamp / 1 days) * 1 days;
    }

    receive() external payable {}

    function setPolicy(uint256 _dailyCapUsdCents, uint256 _perTxCapUsdCents) external onlyOwner {
        dailyCapUsdCents = _dailyCapUsdCents;
        perTxCapUsdCents = _perTxCapUsdCents;
        emit PolicyUpdated(_dailyCapUsdCents, _perTxCapUsdCents);
    }

    function setVendorAllowed(address vendor, bool allowed) external onlyOwner {
        vendorAllowlist[vendor] = allowed;
    }

    function setMinPaymentInterval(uint256 secondsBetween) external onlyOwner {
        minPaymentInterval = secondsBetween;
    }

    /// @dev Rolls the daily counter to the fixed UTC day of block.timestamp.
    ///      Called at the top of EVERY function that reads or writes
    ///      spentTodayUsdCents, so the window can never be silently stale.
    function _rollDay() internal {
        uint256 fixedDayStart = (block.timestamp / 1 days) * 1 days;
        if (dayStart != fixedDayStart) {
            emit DayRollover(fixedDayStart / 1 days, spentTodayUsdCents);
            dayStart = fixedDayStart;
            spentTodayUsdCents = 0;
        }
    }

    /// @dev Prices weiAmount in USD cents. Returns ok = false when the feed is
    ///      stale/invalid or the amount rounds below one cent; the caller must
    ///      escalate instead of approving.
    function _priceUsdCents(uint256 weiAmount)
        internal view returns (bool ok, uint256 usdCents, string memory reason)
    {
        (, int256 price,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (price <= 0) return (false, 0, "invalid price");
        // Staleness check: an old round must never decide approve vs escalate.
        if (block.timestamp < updatedAt || block.timestamp - updatedAt > PRICE_STALENESS) {
            return (false, 0, "stale price feed");
        }
        uint8 dec = priceFeed.decimals();
        usdCents = (weiAmount * uint256(price) * 100) / (10 ** dec) / 1e18;
        if (weiAmount > 0 && usdCents == 0) {
            return (false, 0, "amount below 1-cent accounting resolution");
        }
        return (true, usdCents, "");
    }

    function requestPayment(address payable vendor, uint256 amountWei, string calldata resource)
        external onlyAgent nonReentrant returns (uint256 id)
    {
        _rollDay();
        id = payments.length;

        if (address(this).balance < amountWei) {
            payments.push(Payment(vendor, amountWei, 0, Status.Rejected, block.timestamp, resource));
            emit PaymentRejected(id, vendor, "insufficient balance");
            return id;
        }

        (bool priced, uint256 usdCents, string memory priceReason) = _priceUsdCents(amountWei);

        bool overPerTx = priced && usdCents > perTxCapUsdCents;
        bool overDaily = priced && spentTodayUsdCents + usdCents > dailyCapUsdCents;
        bool vendorNotAllowed = !vendorAllowlist[vendor];

        if (!priced || overPerTx || overDaily || vendorNotAllowed) {
            payments.push(Payment(vendor, amountWei, usdCents, Status.Escalated, block.timestamp, resource));
            string memory reason = vendorNotAllowed
                ? "vendor not allowlisted"
                : (!priced ? priceReason : (overPerTx ? "exceeds per-tx cap" : "exceeds daily cap"));
            emit PaymentEscalated(id, vendor, amountWei, usdCents, resource, reason);
            return id;
        }

        if (minPaymentInterval > 0) {
            require(block.timestamp - _lastApprovedAt >= minPaymentInterval, "payment rate limited");
        }

        spentTodayUsdCents += usdCents;
        _lastApprovedAt = block.timestamp;
        payments.push(Payment(vendor, amountWei, usdCents, Status.Approved, block.timestamp, resource));
        (bool ok, ) = vendor.call{value: amountWei}("");
        require(ok, "transfer failed");
        emit PaymentApproved(id, vendor, amountWei, usdCents, resource);
    }

    /// @dev Call only after the human owner has confirmed on a Ledger device (Clear Signing).
    function releasePayment(uint256 id) external onlyOwner nonReentrant {
        Payment storage p = payments[id];
        require(p.status == Status.Escalated, "not escalated");
        require(block.timestamp <= p.timestamp + ESCALATION_TTL, "escalation expired");
        require(address(this).balance >= p.amountWei, "insufficient balance");
        // Roll the day BEFORE attributing the spend, so a release can never
        // land in a window that is about to be reset.
        _rollDay();
        p.status = Status.Released;
        spentTodayUsdCents += p.amountUsdCents;
        (bool ok, ) = payable(p.vendor).call{value: p.amountWei}("");
        require(ok, "transfer failed");
        emit PaymentReleased(id, p.vendor, p.amountWei);
    }

    function rejectPayment(uint256 id, string calldata reason) external onlyOwner {
        Payment storage p = payments[id];
        require(p.status == Status.Escalated, "not escalated");
        p.status = Status.Rejected;
        emit PaymentRejected(id, p.vendor, reason);
    }

    /// @notice Emergency withdrawal for incident response (e.g. agent key compromise).
    function sweepTo(address payable to, uint256 amountWei) external onlyOwner nonReentrant {
        (bool ok, ) = to.call{value: amountWei}("");
        require(ok, "transfer failed");
    }

    function paymentsCount() external view returns (uint256) { return payments.length; }
}
