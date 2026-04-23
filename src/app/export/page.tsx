import { Dashboard } from "@/components/Dashboard";

export default function ExportPage() {
  return (
    <div className="min-h-0 flex-1 bg-transparent">
      <Dashboard tradeDirection="export" />
    </div>
  );
}
