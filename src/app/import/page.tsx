import { Dashboard } from "@/components/Dashboard";

export default function ImportPage() {
  return (
    <div className="min-h-0 flex-1 bg-slate-50">
      <Dashboard tradeDirection="import" />
    </div>
  );
}
