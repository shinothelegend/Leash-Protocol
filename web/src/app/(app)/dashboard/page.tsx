'use client';

import { useState } from 'react';
import { Card, Metric, Text, AreaChart, BadgeDelta, Flex, Button as TremorButton } from '@tremor/react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowRight, Activity, ShieldCheck, Zap, PlayCircle, AlertTriangle } from 'lucide-react';
import { useReadContract, useReadContracts } from 'wagmi';
import { POLICY_VAULT_ADDRESS, POLICY_VAULT_ABI } from '@/lib/contracts';
import { AntiGravity, AntiGravityContainer } from '@/components/AntiGravity';
import { Counter } from '@/components/Counter';
import { motion } from 'framer-motion';

const STATUS_MAP = ['None', 'Approved', 'Escalated', 'Rejected', 'Released'];

const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'Approved' || status === 'Released') return <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 font-mono text-xs shadow-none">{status}</Badge>;
  if (status === 'Escalated') return <Badge className="bg-amber-50 text-amber-600 border-amber-200 font-mono text-xs shadow-none">Escalated</Badge>;
  if (status === 'Rejected') return <Badge className="bg-red-50 text-red-600 font-mono text-xs border-red-200 shadow-none">Rejected</Badge>;
  return <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-mono text-xs shadow-none">{status}</Badge>;
};

const DemoButton = ({ amount, label, icon }: { amount: number, label: string, icon: React.ReactNode }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{txHash?: string, isEscalated?: boolean, error?: string} | null>(null);

  const handlePay = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/demo/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountUsd: amount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to execute payment');
      setResult(data);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <TremorButton 
        size="xs" 
        variant={amount > 0.5 ? "secondary" : "primary"}
        onClick={handlePay} 
        loading={loading}
        className="shadow-sm"
      >
        {icon}
        {label}
      </TremorButton>
      {result && (
        <div className="text-[10px] font-mono max-w-xs mt-1">
          {result.error && <span className="text-red-500 break-words block">Error: {result.error}</span>}
          {result.txHash && (
            <div className="text-emerald-600 bg-emerald-50/50 p-1.5 rounded border border-emerald-100/50 mt-1">
              <span className="block text-emerald-800 font-semibold mb-0.5">Tx Hash:</span>
              <span className="break-all select-all">{result.txHash}</span>
            </div>
          )}
          {result.isEscalated && !result.txHash && <span className="text-amber-600 block mt-1">Escalated for approval</span>}
        </div>
      )}
    </div>
  );
};

export default function DashboardPage() {
  const { data: spentToday } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'spentTodayUsdCents',
  });

  const { data: dailyCap } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'dailyCapUsdCents',
  });

  const { data: paymentsCount } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'paymentsCount',
  });

  const spentUsd = spentToday ? Number(spentToday) / 100 : 0;
  const capUsd = dailyCap ? Number(dailyCap) / 100 : 0;
  const percentSpent = capUsd > 0 ? (spentUsd / capUsd) * 100 : 0;

  const count = Number(paymentsCount || 0n);
  const startIdx = Math.max(0, count - 15);
  const paymentIndices = Array.from({ length: Math.min(15, count) }, (_, i) => BigInt(startIdx + i)).reverse();

  const { data: recentPaymentsData } = useReadContracts({
    contracts: paymentIndices.map(idx => ({
      address: POLICY_VAULT_ADDRESS,
      abi: POLICY_VAULT_ABI,
      functionName: 'payments',
      args: [idx],
    })),
  });

  const allRecent = recentPaymentsData?.map((result, i) => {
    if (result.status === 'success' && result.result) {
      const [vendor, amountWei, amountUsdCents, status, timestamp, resource] = result.result as unknown as [string, bigint, bigint, number, bigint, string];
      return {
        id: paymentIndices[i].toString(),
        vendor: `${vendor.slice(0,6)}...${vendor.slice(-4)}`,
        amount: `$${(Number(amountUsdCents) / 100).toFixed(2)}`,
        amountRaw: Number(amountUsdCents) / 100,
        status: STATUS_MAP[status],
        timestamp: Number(timestamp) * 1000,
        timeLabel: new Date(Number(timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    }
    return null;
  }).filter(Boolean) || [];

  const recentActivity = allRecent.slice(0, 5);
  const chartData = [...allRecent].reverse();

  const cardStyle = "card flex flex-col justify-between";

  return (
    <AntiGravityContainer className="space-y-8 max-w-7xl mx-auto py-8">
      
      <AntiGravity delay={0}>
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-border shadow-sm text-xs font-mono text-ink-600 mb-4">
              <Zap className="w-3.5 h-3.5 text-blue-bright" />
              <span>x402 Spending Firewall Active</span>
            </div>
            <h1 className="font-display font-bold text-3xl md:text-5xl tracking-tight text-ink-900">
              Agent Capacity Telemetry
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-border shadow-sm text-xs font-mono text-emerald-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 status-dot"></span>
              Hedera Testnet: Connected
            </span>
          </div>
        </div>
      </AntiGravity>

      {/* Demo Controls */}
      <AntiGravity delay={0.05}>
        <Card className="mb-8 border-indigo-200 bg-indigo-50/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <Text className="text-indigo-900 font-bold text-lg flex items-center gap-2">
                <PlayCircle className="w-5 h-5 text-indigo-600" /> Demo Controls
              </Text>
              <Text className="text-indigo-700 text-sm mt-1">Trigger real on-chain x402 payments to demonstrate the policy firewall.</Text>
            </div>
            <div className="flex gap-4">
              <DemoButton amount={0.01} label="Send small payment ($0.01)" icon={<Zap className="w-4 h-4 mr-2" />} />
              <DemoButton amount={0.75} label="Send over-cap payment ($0.75)" icon={<AlertTriangle className="w-4 h-4 mr-2" />} />
            </div>
          </div>
        </Card>
      </AntiGravity>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <AntiGravity delay={0.1}>
          <Card className={cardStyle}>
            <Text className="text-ink-600 text-xs uppercase font-mono tracking-wider font-semibold">Spent Today</Text>
            <Metric className="text-ink-900 font-display mt-2 font-bold text-4xl">
              $<Counter to={spentUsd} formatter={(v) => v.toFixed(2)} />
            </Metric>
            <div className="mt-4 pt-4 border-t border-border">
              <Flex className="mb-2">
                <Text className="text-ink-600 text-xs font-mono truncate">{percentSpent.toFixed(1)}% of daily cap</Text>
              </Flex>
              {/* Replace ProgressBar with animated line */}
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }} 
                  animate={{ width: `${Math.min(percentSpent, 100)}%` }} 
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className="h-full bg-blue-bright" 
                />
              </div>
            </div>
          </Card>
        </AntiGravity>
        
        <AntiGravity delay={0.2}>
          <Card className={cardStyle}>
            <Text className="text-ink-600 text-xs uppercase font-mono tracking-wider font-semibold">Daily Policy Cap</Text>
            <Metric className="text-blue-deep font-display mt-2 font-bold text-4xl">
              $<Counter to={capUsd} formatter={(v) => v.toFixed(2)} />
            </Metric>
            <div className="mt-4 pt-4 border-t border-border">
              <Flex>
                <Text className="text-ink-600 text-xs font-mono truncate">Resets in 24h</Text>
              </Flex>
            </div>
          </Card>
        </AntiGravity>
        
        <AntiGravity delay={0.3}>
          <Card className={cardStyle}>
            <Text className="text-ink-600 text-xs uppercase font-mono tracking-wider font-semibold">Total On-Chain Jobs</Text>
            <Metric className="text-ink-900 font-display mt-2 font-bold text-4xl">
              <Counter to={count} />
            </Metric>
            <div className="mt-4 pt-4 border-t border-border">
              <Flex>
                <BadgeDelta deltaType="increase" size="xs" className="bg-blue-50 text-blue-deep font-mono border border-blue-100 shadow-none rounded">x402 Verified</BadgeDelta>
              </Flex>
            </div>
          </Card>
        </AntiGravity>
        
        <AntiGravity delay={0.4}>
          <Card className={`${cardStyle} bg-blue-deep !border-blue-900`}>
            <Text className="text-blue-100 text-xs uppercase font-mono tracking-wider font-semibold">Firewall Status</Text>
            <div className="flex items-center gap-3 mt-4">
              <ShieldCheck className="w-8 h-8 text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]" />
              <Metric className="text-white text-3xl font-display font-bold">ENFORCING</Metric>
            </div>
            <div className="mt-4 pt-4 border-t border-blue-800">
              <Flex>
                <Text className="text-blue-200 text-xs font-mono">Ledger DMK Ready</Text>
              </Flex>
            </div>
          </Card>
        </AntiGravity>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Charts) */}
        <AntiGravity delay={0.5} className="lg:col-span-2 h-full">
          <Card className={`${cardStyle} h-full min-h-[380px]`}>
            <div className="mb-4">
              <Text className="text-ink-900 text-lg font-bold font-display tracking-tight">Recent Settlement Volume ($USD over x402)</Text>
            </div>
            
            {chartData.length > 0 ? (
              <AreaChart
                className="h-72 mt-4"
                data={chartData}
                index="timeLabel"
                categories={["amountRaw"]}
                colors={["blue"]}
                valueFormatter={(number) => `$${number.toFixed(2)}`}
                showLegend={false}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Activity className="w-10 h-10 text-slate-300 mb-3" />
                <Text className="text-ink-400 text-sm font-mono">Waiting for on-chain telemetry data...</Text>
              </div>
            )}
          </Card>
        </AntiGravity>

        {/* Right Column (Activity) */}
        <AntiGravity delay={0.6} className="lg:col-span-1 h-full">
          <Card className={`${cardStyle} h-full`}>
            <div className="flex justify-between items-center mb-5 border-b border-border pb-4">
              <Text className="text-ink-900 text-lg font-bold font-display tracking-tight">Recent Settlements</Text>
              <Link href="/payments" className="text-blue-bright hover:text-blue-deep text-xs font-mono flex items-center transition-colors">
                View all <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </div>
            
            <div className="flex-1 space-y-3">
              {recentActivity.length === 0 ? (
                 <div className="text-center py-10 text-ink-400 text-xs font-mono">No recent x402 settlements</div>
              ) : recentActivity.map((tx: any, idx: number) => (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + (idx * 0.1), ease: "easeOut" }}
                  key={tx.id} 
                  className="flex justify-between items-center p-3.5 rounded-lg bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-sm hover:border-slate-200 transition-all cursor-pointer"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-sm text-ink-900 font-semibold">{tx.vendor}</span>
                    <span className="text-[10px] font-mono text-ink-400">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-mono text-sm font-bold text-blue-deep">{tx.amount}</span>
                    <StatusBadge status={tx.status} />
                  </div>
                </motion.div>
              ))}
            </div>
          </Card>
        </AntiGravity>
      </div>
    </AntiGravityContainer>
  );
}

