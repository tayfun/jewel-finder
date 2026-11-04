import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { Inventory } from "./Inventory";
import { Landing } from "./Landing";
import { Loader } from "../components/Loader";

/** "/" is the marketing page for visitors and the inventory for signed-in users. */
export function Home() {
  const { account, loading } = useAuth();
  if (loading) return <Loader full label="Loading Jewel Finder…" />;
  if (!account) return <Landing />;
  return (
    <Layout>
      <Inventory />
    </Layout>
  );
}
