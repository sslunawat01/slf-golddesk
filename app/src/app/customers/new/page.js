import Shell from "@/components/Shell.js";
import { q } from "@/lib/db.js";
import NewCustomerClient from "./NewCustomerClient.js";
export const dynamic = "force-dynamic";

export default async function NewCustomerPage({ searchParams }) {
  const sp = await searchParams;
  const docTypes = await q(
    `SELECT id, name, category FROM document_type WHERE active ORDER BY category, name`);
  return (
    <Shell title="New customer">
      <p style={{ color: "var(--mut)", fontSize: 14, marginTop: -8, marginBottom: 16 }}>
        Full KYC · valid 3 years, expiry tracked automatically · photos are compressed on this device.
      </p>
      <NewCustomerClient docTypes={docTypes.map(d => ({ ...d, id: Number(d.id) }))} prefill={sp?.q || ""} />
    </Shell>
  );
}
