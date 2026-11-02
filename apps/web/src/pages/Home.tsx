import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { Inventory } from "./Inventory";
import { Landing } from "./Landing";

/** "/" is the marketing page for visitors and the inventory for signed-in users. */
export function Home() {
  const { account, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!account) return <Landing />;
  return (
    <Layout>
      <Inventory />
    </Layout>
  );
}
