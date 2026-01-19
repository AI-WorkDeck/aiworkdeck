export default function AdminDashboard() {
    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-text-1">Admin Dashboard</h1>

            {/* KPI Cards */}
            <div className="grid md:grid-cols-4 gap-6">
                {[
                    { label: "Total Revenue", value: "$124,500", change: "+12%" },
                    { label: "Active Users", value: "1,240", change: "+5%" },
                    { label: "Plugins Active", value: "45", change: "+2" },
                    { label: "Pending Issues", value: "3", change: "-1" },
                ].map((stat, i) => (
                    <div key={i} className="p-6 bg-surface border border-border rounded-xl shadow-sm">
                        <h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">{stat.label}</h3>
                        <div className="flex items-end justify-between">
                            <span className="text-2xl font-bold text-text-1">{stat.value}</span>
                            <span className={stat.change.startsWith("+") ? "text-semantic-success text-sm" : "text-semantic-danger text-sm"}>
                                {stat.change}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-12 border border-dashed border-border rounded-xl text-center text-text-3 bg-surface-alt/20">
                [Placeholder for Revenue Chart / User Growth Graph]
            </div>
        </div>
    );
}
