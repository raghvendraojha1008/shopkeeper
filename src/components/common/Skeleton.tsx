import React from 'react';

export const Skeleton = ({ className }: { className?: string }) => (
    <div className={`animate-pulse bg-[rgba(255,255,255,0.09)] rounded ${className}`}></div>
);

export const CardSkeleton = () => (
    <div className="p-4 rounded-xl border border-white/10 mb-3">
        <div className="flex justify-between items-start mb-3">
            <div className="space-y-2 w-1/2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-white/08">
            <Skeleton className="h-4 w-1/3" />
            <div className="flex gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
        </div>
    </div>
);

export const RowSkeleton = () => (
    <div className="p-3 rounded-lg border border-white/10 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 w-2/3">
            <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="space-y-2 w-full">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
            </div>
        </div>
        <Skeleton className="h-5 w-16" />
    </div>
);

export const LoadingStack = ({ type = 'card', count = 4 }: { type?: 'card' | 'row', count?: number }) => (
    <div className="w-full animate-in fade-in duration-500">
        {Array.from({ length: count }).map((_, i) => (
            type === 'card' ? <CardSkeleton key={i} /> : <RowSkeleton key={i} />
        ))}
    </div>
);

// Pending Dues specific skeleton - matches the rounded card style
export const PendingSkeleton = ({ count = 4 }: { count?: number }) => (
    <div className="w-full animate-in fade-in duration-500 space-y-4">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-[2rem] border border-white/10 p-5">
                <div className="flex justify-between items-start">
                    <div className="flex-1 space-y-3">
                        <div className="flex gap-2">
                            <Skeleton className="h-5 w-16 rounded-full" />
                            <Skeleton className="h-5 w-20 rounded-full" />
                        </div>
                        <Skeleton className="h-5 w-2/3" />
                    </div>
                    <div className="text-right space-y-2">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-6 w-20" />
                    </div>
                </div>
            </div>
        ))}
    </div>
);

// Dashboard widget skeleton
export const DashboardSkeleton = () => (
    <div className="w-full animate-in fade-in duration-500 p-5 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
            <div className="space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
                <div key={i} className="rounded-2xl p-4 border border-white/10">
                    <Skeleton className="h-4 w-16 mb-3" />
                    <Skeleton className="h-8 w-24" />
                </div>
            ))}
        </div>
        
        {/* Chart placeholder */}
        <div className="rounded-2xl p-4 border border-white/10">
            <Skeleton className="h-4 w-24 mb-4" />
            <Skeleton className="h-48 w-full rounded-xl" />
        </div>
    </div>
);

// Inventory list skeleton
export const InventorySkeleton = ({ count = 5 }: { count?: number }) => (
    <div className="w-full animate-in fade-in duration-500 space-y-3">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-2xl p-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-12 w-12 rounded-xl" />
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-20" />
                        </div>
                    </div>
                    <div className="text-right space-y-2">
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-3 w-12" />
                    </div>
                </div>
            </div>
        ))}
    </div>
);

// Parties list skeleton
export const PartiesSkeleton = ({ count = 5 }: { count?: number }) => (
    <div className="w-full animate-in fade-in duration-500 space-y-3 p-4">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-2xl p-4">
                <div className="flex justify-between items-start mb-3">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-4 w-12 rounded-full" />
                        </div>
                        <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <Skeleton className="h-8 w-8 rounded-lg" />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-dashed border-white/08 mb-2">
                    <div className="space-y-1">
                        <Skeleton className="h-2 w-12" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="space-y-1">
                        <Skeleton className="h-2 w-12" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="space-y-1 text-right">
                        <Skeleton className="h-2 w-12 ml-auto" />
                        <Skeleton className="h-5 w-20 ml-auto" />
                    </div>
                </div>
                <div className="flex justify-between">
                    <Skeleton className="h-6 w-24 rounded-lg" />
                    <Skeleton className="h-4 w-16" />
                </div>
            </div>
        ))}
    </div>
);

// Transactions list skeleton
export const TransactionsSkeleton = ({ count = 6 }: { count?: number }) => (
    <div className="w-full animate-in fade-in duration-500 space-y-2">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-xl p-3 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[rgba(255,255,255,0.09)]"></div>
                <div className="pl-2 space-y-2">
                    <div className="flex justify-between">
                        <div className="flex gap-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-12 rounded" />
                        </div>
                        <Skeleton className="h-3 w-14" />
                    </div>
                    <div className="flex justify-between items-center">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                </div>
                <div className="mt-2 pt-2 border-t border-white/08 flex justify-end gap-2">
                    <Skeleton className="h-6 w-6 rounded-lg" />
                    <Skeleton className="h-6 w-16 rounded-lg" />
                </div>
            </div>
        ))}
    </div>
);

// Ledger list skeleton
export const LedgerSkeleton = ({ count = 5 }: { count?: number }) => (
    <div className="w-full animate-in fade-in duration-500 space-y-2">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-xl p-3 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[rgba(255,255,255,0.09)]"></div>
                <div className="pl-2 space-y-2">
                    <div className="flex justify-between">
                        <div className="flex gap-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-14 rounded" />
                        </div>
                        <Skeleton className="h-3 w-12" />
                    </div>
                    <div className="flex justify-between items-center">
                        <Skeleton className="h-5 w-36" />
                        <Skeleton className="h-6 w-24" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-3 w-4 rounded" />
                        <Skeleton className="h-3 w-48" />
                    </div>
                </div>
                <div className="mt-2 pt-2 border-t border-white/08 flex justify-end gap-2">
                    <Skeleton className="h-6 w-6 rounded-lg" />
                    <Skeleton className="h-6 w-16 rounded-lg" />
                </div>
            </div>
        ))}
    </div>
);

// Vehicles list skeleton
export const VehiclesSkeleton = ({ count = 4 }: { count?: number }) => (
    <div className="w-full animate-in fade-in duration-500 space-y-3 p-4">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-2xl p-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-12 w-12 rounded-xl" />
                        <div className="space-y-2">
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="h-3 w-20" />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <Skeleton className="h-8 w-8 rounded-lg" />
                    </div>
                </div>
            </div>
        ))}
    </div>
);






