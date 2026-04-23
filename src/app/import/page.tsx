import { Dashboard } from "@/components/Dashboard";

export default function ImportPage() {
  return (
    <div className="min-h-0 flex-1 bg-transparent">
      <Dashboard tradeDirection="import" />
    </div>
  );
}
