import { Download, CreditCard, Clock } from "lucide-react";

export default function DashboardPage() {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-text-1 mb-2">Overview</h1>
                <p className="text-text-2">Manage your subscription, downloads, and plugins.</p>
            </div>

            {/* Stats / Entitlements */}
            <div className="grid md:grid-cols-3 gap-6">
                <div className="p-6 bg-surface border border-border rounded-xl shadow-sm">
                    <h3 className="text-sm font-medium text-text-3 mb-4 uppercase tracking-wider">Current Plan</h3>
                    <div className="text-2xl font-bold text-text-1 mb-1">Professional</div>
                    <div className="text-sm text-brand">Active until Dec 31, 2026</div>
                </div>
                <div className="p-6 bg-surface border border-border rounded-xl shadow-sm">
                    <h3 className="text-sm font-medium text-text-3 mb-4 uppercase tracking-wider">AI Credits</h3>
                    <div className="text-2xl font-bold text-text-1 mb-1">Unlimited</div>
                    <div className="text-sm text-text-3">Usage resets daily</div>
                </div>
                <div className="p-6 bg-surface border border-border rounded-xl shadow-sm">
                    <h3 className="text-sm font-medium text-text-3 mb-4 uppercase tracking-wider">Installed Plugins</h3>
                    <div className="text-2xl font-bold text-text-1 mb-1">3</div>
                    <div className="text-sm text-text-3">All up to date</div>
                </div>
            </div>

            {/* Recent Orders Table */}
            <section className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-6 border-b border-border flex justify-between items-center">
                    <h2 className="text-lg font-bold text-text-1">Recent Activity</h2>
                    <button className="text-sm text-brand font-medium hover:underline">View All</button>
                </div>
                <table className="w-full text-left text-sm">
                    <thead className="bg-surface-alt/50 text-text-3 font-medium">
                        <tr>
                            <th className="px-6 py-3">Order ID</th>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Item</th>
                            <th className="px-6 py-3">Amount</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {[1, 2].map((i) => (
                            <tr key={i} className="hover:bg-surface-alt/20 transition-colors">
                                <td className="px-6 py-4 font-mono text-text-2">#ORD-2026-00{i}</td>
                                <td className="px-6 py-4 text-text-1">Jan 1{i}, 2026</td>
                                <td className="px-6 py-4 text-text-1">Professional Plan (Monthly)</td>
                                <td className="px-6 py-4 text-text-1">$29.00</td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center px-2 py-1 rounded bg-semantic-success/10 text-semantic-success text-xs font-bold">
                                        Paid
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button className="text-text-3 hover:text-brand transition-colors">
                                        <Download className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

        </div>
    );
}
