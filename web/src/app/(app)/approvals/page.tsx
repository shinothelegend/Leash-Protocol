'use client';

import { useState } from 'react';
import { Card, Metric, Text, DonutChart, ProgressBar, Flex } from '@tremor/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, X, CheckCircle2, Loader2, Copy } from 'lucide-react';
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { POLICY_VAULT_ADDRESS, POLICY_VAULT_ABI } from '@/lib/contracts';
import { AntiGravity, AntiGravityContainer } from '@/components/AntiGravity';

export default function ApprovalsPage() {
  const [signingId, setSigningId] = useState<string | null>(null);

  const { data: paymentsCount } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'paymentsCount',
  });

  const { data: dailyCap } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'dailyCapUsdCents',
  });

  const { data: perTxCap } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'perTxCapUsdCents',
  });

  const { data: spentToday } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'spentTodayUsdCents',
  });

  const capUsd = dailyCap ? Number(dailyCap) / 100 : 0;
  const perTxCapUsd = perTxCap ? Number(perTxCap) / 100 : 0.50;
  const spentUsd = spentToday ? Number(spentToday) / 100 : 0;

  const count = Number(paymentsCount || 0n);
  const limit = Math.min(50, count);
  const startIdx = Math.max(0, count - limit);
  const paymentIndices = Array.from({ length: limit }, (_, i) => BigInt(startIdx + i)).reverse();

  const { data: paymentsData, refetch } = useReadContracts({
    contracts: paymentIndices.map(idx => ({
      address: POLICY_VAULT_ADDRESS,
      abi: POLICY_VAULT_ABI,
      functionName: 'payments',
      args: [idx],
    })),
  });

  const getReason = (amountUsdRaw: number) => {
    if (amountUsdRaw > perTxCapUsd) {
      return `Exceeds per-tx cap ($${perTxCapUsd.toFixed(2)})`;
    }
    if (spentUsd + amountUsdRaw > capUsd) {
      return `Exceeds daily cap ($${capUsd.toFixed(2)})`;
    }
    return 'Policy Escalation';
  };

  const allPayments = paymentsData?.map((result, i) => {
    if (result.status === 'success' && result.result) {
      const [vendor, amountWei, amountUsdCents, status, timestamp, resource] = result.result as unknown as [string, bigint, bigint, number, bigint, string];
      const usdVal = Number(amountUsdCents) / 100;
      return {
        id: paymentIndices[i].toString(),
        vendor,
        amountWei: amountWei.toString(),
        amountUsd: `$${usdVal.toFixed(2)}`,
        amountUsdRaw: usdVal,
        status, 
        timestamp: Number(timestamp) * 1000,
        reason: getReason(usdVal),
      };
    }
    return null;
  }).filter(Boolean) || [];

  const pendingRequests = allPayments.filter(p => p?.status === 2);
  const approvedCount = allPayments.filter(p => p?.status === 1 || p?.status === 4).length;
  const rejectedCount = allPayments.filter(p => p?.status === 3).length;

  const donutData = [
    { name: 'Pending', value: pendingRequests.length },
    { name: 'Approved', value: approvedCount },
    { name: 'Rejected', value: rejectedCount },
  ].filter(d => d.value > 0);

  const pendingValue = pendingRequests.reduce((acc, p) => acc + (p?.amountUsdRaw || 0), 0);

  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading: isWaiting } = useWaitForTransactionReceipt({ hash: txHash });

  if (txHash && !isWaiting && signingId) {
    setSigningId(null);
    refetch();
  }

  const handleApprove = (id: string) => {
    setSigningId(id);
    writeContract({
      address: POLICY_VAULT_ADDRESS,
      abi: POLICY_VAULT_ABI,
      functionName: 'releasePayment',
      args: [BigInt(id)],
    });
  };

  const handleReject = (id: string) => {
    setSigningId(id);
    writeContract({
      address: POLICY_VAULT_ADDRESS,
      abi: POLICY_VAULT_ABI,
      functionName: 'rejectPayment',
      args: [BigInt(id), "Rejected by admin"],
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const cardStyle = "card";

  return (
    <AntiGravityContainer className="space-y-8 max-w-7xl mx-auto pb-10">
      <AntiGravity delay={0}>
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight text-ink-900">Pending Approvals</h2>
          <p className="text-ink-600 text-sm mt-1">Review and release escalated payments (Demo: releases via connected wallet instead of Ledger DMK).</p>
        </div>
      </AntiGravity>

      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AntiGravity delay={0.1}>
          <Card className={cardStyle}>
            <Text className="text-ink-600 font-semibold uppercase tracking-wider text-xs">Approval Status</Text>
            <div className="flex items-center justify-between mt-4">
              {donutData.length > 0 ? (
                <DonutChart
                  className="w-24 h-24"
                  data={donutData}
                  category="value"
                  index="name"
                  colors={["amber", "emerald", "red"]}
                  showLabel={false}
                  showAnimation={true}
                />
              ) : (
                <div className="w-24 h-24 flex items-center justify-center text-ink-400 text-sm">No data</div>
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500"></div><span className="text-sm text-ink-900 font-medium">{pendingRequests.length} Pending</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div><span className="text-sm text-ink-900 font-medium">{approvedCount} Approved</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div><span className="text-sm text-ink-900 font-medium">{rejectedCount} Rejected</span></div>
              </div>
            </div>
          </Card>
        </AntiGravity>

        <AntiGravity delay={0.2}>
          <Card className={cardStyle}>
            <Text className="text-ink-600 font-semibold uppercase tracking-wider text-xs">Pending Value</Text>
            <Metric className="text-pink-hot font-display mt-2">${pendingValue.toFixed(2)}</Metric>
            <Text className="text-ink-600 text-sm mt-4">Total USD value of {pendingRequests.length} escalated payment(s).</Text>
          </Card>
        </AntiGravity>

        <AntiGravity delay={0.3}>
          <Card className={cardStyle}>
            <Text className="text-ink-600 font-semibold uppercase tracking-wider text-xs">This Session</Text>
            <div className="flex justify-between items-end mt-2">
              <Metric className="text-ink-900 font-display">${spentUsd.toFixed(2)}</Metric>
              <Text className="text-ink-600 text-sm font-mono mb-1">/ ${capUsd.toFixed(2)}</Text>
            </div>
            <ProgressBar value={capUsd > 0 ? (spentUsd / capUsd) * 100 : 0} color="blue" className="mt-4 opacity-80" />
          </Card>
        </AntiGravity>
      </div>

      {/* Approvals Queue */}
      <div className="mt-8">
        {pendingRequests.length === 0 ? (
          <AntiGravity delay={0.4}>
            <Card className="bg-slate-50/50 border border-border border-dashed ring-0 py-16 flex flex-col items-center justify-center shadow-none">
              <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-blue-bright" />
              </div>
              <h3 className="text-lg font-display font-bold tracking-tight text-ink-900">All clear</h3>
              <p className="text-ink-600">No payments awaiting approval.</p>
            </Card>
          </AntiGravity>
        ) : (
          <AntiGravityContainer className="space-y-6">
            {pendingRequests.map(req => req && (
              <AntiGravity key={req.id}>
                <Card className="card relative overflow-hidden group hover:shadow-soft-hover hover:-translate-y-[2px] transition-all duration-300">
                  <div className="flex flex-col md:flex-row justify-between gap-6 p-2">
                    {/* Left info */}
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center gap-3">
                        <Badge className="bg-amber-50 text-amber-600 border-amber-200 px-3 py-1 text-sm font-medium uppercase tracking-wider font-display shadow-none">
                          {req.reason}
                        </Badge>
                        <span className="text-ink-600 text-sm">{new Date(req.timestamp).toLocaleString()}</span>
                      </div>
                      
                      <div>
                        <Text className="text-ink-600 mb-1 font-semibold uppercase tracking-wider text-xs">Vendor Address</Text>
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-ink-900 text-sm bg-slate-50 px-2 py-1 rounded border border-border">{req.vendor}</p>
                          <button onClick={() => copyToClipboard(req.vendor)} className="p-1.5 rounded bg-slate-50 border border-border hover:border-blue-bright text-ink-600 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>

                      <div className="max-w-xs pt-2">
                        <Flex className="mb-2">
                          <Text className="text-ink-600 text-xs font-semibold uppercase tracking-wider">Impact on daily cap</Text>
                          <Text className="text-pink-hot font-mono text-xs font-bold">+{capUsd > 0 ? ((req.amountUsdRaw / capUsd) * 100).toFixed(1) : 0}%</Text>
                        </Flex>
                        <ProgressBar value={capUsd > 0 ? (req.amountUsdRaw / capUsd) * 100 : 0} color="blue" />
                      </div>
                    </div>
                    
                    {/* Right actions */}
                    <div className="flex flex-col items-start md:items-end justify-between border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-6 min-w-[240px]">
                      <div className="mb-6 md:text-right">
                        <Text className="text-ink-600 mb-1 font-semibold uppercase tracking-wider text-xs">Requested Amount</Text>
                        <div className="flex items-baseline gap-2 md:justify-end">
                          <span className="text-4xl font-mono text-ink-900 font-bold">{req.amountUsd}</span>
                        </div>
                        <Text className="text-ink-400 font-mono text-xs mt-1">{req.amountWei} WEI</Text>
                      </div>

                      <div className="flex gap-3 w-full md:w-auto">
                        <Button 
                          variant="outline" 
                          onClick={() => handleReject(req.id)}
                          disabled={signingId !== null}
                          className="flex-1 border-border text-ink-600 bg-white hover:bg-slate-50 hover:text-ink-900"
                        >
                          <X className="w-4 h-4 mr-2" /> Reject
                        </Button>
                        <Button 
                          onClick={() => handleApprove(req.id)}
                          disabled={signingId !== null}
                          className="flex-2 bg-blue-deep hover:bg-blue-deep/90 text-white border-0 shadow-sm transition-all font-display tracking-wide font-bold"
                        >
                          {signingId === req.id ? (
                            <span className="flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing...</span>
                          ) : (
                            <span className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2" /> Approve & Release</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </AntiGravity>
            ))}
          </AntiGravityContainer>
        )}
      </div>
    </AntiGravityContainer>
  );
}
