'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Card } from '@tremor/react';
import { Receipt, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useReadContract, useReadContracts } from 'wagmi';
import { POLICY_VAULT_ADDRESS, POLICY_VAULT_ABI } from '@/lib/contracts';
import { useState } from 'react';
import { AntiGravity, AntiGravityContainer } from '@/components/AntiGravity';

const STATUS_MAP = ['None', 'Approved', 'Escalated', 'Rejected', 'Released'];

const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'Approved' || status === 'Released') return <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 font-mono text-xs shadow-none">{status}</Badge>;
  if (status === 'Escalated') return <Badge className="bg-amber-50 text-amber-600 border-amber-200 font-mono text-xs shadow-none">Escalated</Badge>;
  if (status === 'Rejected') return <Badge className="bg-red-50 text-red-600 font-mono text-xs border-red-200 shadow-none">Rejected</Badge>;
  return <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-mono text-xs shadow-none">{status}</Badge>;
};

export default function PaymentsPage() {
  const tabs = ['All', 'Approved', 'Escalated', 'Rejected', 'Released'];
  const [filter, setFilter] = useState('All');

  const { data: paymentsCount } = useReadContract({
    address: POLICY_VAULT_ADDRESS,
    abi: POLICY_VAULT_ABI,
    functionName: 'paymentsCount',
  });

  const count = Number(paymentsCount || 0n);
  const limit = Math.min(50, count);
  const startIdx = Math.max(0, count - limit);
  const paymentIndices = Array.from({ length: limit }, (_, i) => BigInt(startIdx + i)).reverse();

  const { data: paymentsData } = useReadContracts({
    contracts: paymentIndices.map(idx => ({
      address: POLICY_VAULT_ADDRESS,
      abi: POLICY_VAULT_ABI,
      functionName: 'payments',
      args: [idx],
    })),
  });

  const allPayments = paymentsData?.map((result, i) => {
    if (result.status === 'success' && result.result) {
      const [vendor, amountWei, amountUsdCents, status, timestamp, resource] = result.result as unknown as [string, bigint, bigint, number, bigint, string];
      return {
        id: paymentIndices[i].toString(),
        vendor,
        amount: `$${(Number(amountUsdCents) / 100).toFixed(2)}`,
        status: STATUS_MAP[status],
        resource,
        timestamp: Number(timestamp) * 1000,
      };
    }
    return null;
  }).filter(Boolean) || [];

  const filteredPayments = filter === 'All' 
    ? allPayments 
    : allPayments.filter(p => p?.status === filter);

  return (
    <AntiGravityContainer className="space-y-8 max-w-7xl mx-auto h-full flex flex-col pb-10">
      <AntiGravity delay={0} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight text-ink-900">Live Payment Feed</h2>
          <p className="text-ink-600 text-sm mt-1">Real-time stream of all agent transactions and policy evaluations.</p>
        </div>
        
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
          <Input 
            placeholder="Search vendor or TxHash..." 
            className="pl-9 bg-white border-border text-ink-900 placeholder:text-ink-400 focus-visible:ring-blue-bright font-mono shadow-sm"
          />
        </div>
      </AntiGravity>

      <AntiGravity delay={0.1} className="flex-1 flex flex-col">
        <Card className="card flex-1 flex flex-col p-0 overflow-hidden min-h-[500px]">
          <Tabs defaultValue="All" value={filter} onValueChange={setFilter} className="flex-1 flex flex-col">
            <div className="px-6 pt-6 pb-4 border-b border-border bg-slate-50/50">
              <TabsList className="bg-slate-100 border border-border">
                {tabs.map(tab => (
                  <TabsTrigger 
                    key={tab} 
                    value={tab}
                    className="data-[state=active]:bg-white data-[state=active]:text-ink-900 data-[state=active]:shadow-sm text-ink-600 transition-all font-display tracking-wide"
                  >
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="flex-1 overflow-auto bg-white">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b border-border">
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="w-[100px] text-ink-600 font-display">ID</TableHead>
                    <TableHead className="text-ink-600 font-display">Vendor</TableHead>
                    <TableHead className="text-ink-600 font-display">Amount</TableHead>
                    <TableHead className="text-ink-600 font-display">Status</TableHead>
                    <TableHead className="text-ink-600 font-display">Resource</TableHead>
                    <TableHead className="text-ink-600 font-display">Timestamp</TableHead>
                    <TableHead className="text-ink-600 font-display text-right">HashScan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.length === 0 ? (
                    <TableRow className="hover:bg-transparent border-0">
                      <TableCell colSpan={7} className="h-96 text-center">
                        <div className="flex flex-col items-center justify-center text-ink-400 space-y-4">
                          <div className="w-16 h-16 rounded-full bg-slate-50 border border-border flex items-center justify-center shadow-inner">
                            <Receipt className="w-8 h-8 text-ink-400" />
                          </div>
                          <div className="flex flex-col items-center gap-1">
                            <p className="text-base font-display tracking-tight text-ink-600">No payments found</p>
                            <p className="text-sm">Wait for new transactions or change filter.</p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPayments.map(p => p && (
                      <TableRow key={p.id} className="border-b border-border hover:bg-slate-50 transition-colors">
                        <TableCell className="font-mono text-ink-600">{p.id}</TableCell>
                        <TableCell className="font-mono text-ink-900">{p.vendor.slice(0,6)}...{p.vendor.slice(-4)}</TableCell>
                        <TableCell className="font-mono font-bold text-blue-deep">{p.amount}</TableCell>
                        <TableCell><StatusBadge status={p.status} /></TableCell>
                        <TableCell className="text-ink-600 max-w-[200px] truncate" title={p.resource}>{p.resource}</TableCell>
                        <TableCell className="text-ink-600 text-sm">{new Date(p.timestamp).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <a href={`https://hashscan.io/testnet/account/${POLICY_VAULT_ADDRESS}`} target="_blank" rel="noreferrer" className="text-blue-bright hover:text-blue-deep hover:underline text-sm transition-colors">View Contract</a>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Tabs>
        </Card>
      </AntiGravity>
    </AntiGravityContainer>
  );
}
