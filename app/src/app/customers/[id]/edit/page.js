import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one } from "@/lib/db.js";
import { redirect } from "next/navigation";
import EditCustClient from "./EditCustClient.js";
export const dynamic = "force-dynamic";

export default async function EditCustomerPage({ params }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  const mayEdit = can(actor, "settings", { need: "full" }).ok
    || can(actor, "edit_customer", { need: "full" }).ok;
  if (!mayEdit) redirect("/home");

  const { id } = await params;
  const c = await one(
    `SELECT id, cust_no, full_name, mobile, alt_mobile, email FROM customer WHERE id = $1`, [id]);
  if (!c) redirect("/search");

  const addr = await one(
    `SELECT line1, line2, pincode, area, taluka, district, state
       FROM customer_address WHERE customer_id = $1 AND kind = 'current' LIMIT 1`, [id]);
  const nominee = await one(
    `SELECT name, relation, mobile FROM nominee WHERE customer_id = $1 AND is_current LIMIT 1`,
    [id]);

  return (
    <Shell title="Edit customer">
      <EditCustClient
        customer={{ id: Number(c.id), custNo: c.cust_no, name: c.full_name }}
        contact={{ mobile: c.mobile || "", altMobile: c.alt_mobile || "", email: c.email || "" }}
        address={{ line1: addr?.line1 || "", line2: addr?.line2 || "",
          pincode: addr?.pincode || "", area: addr?.area || "", taluka: addr?.taluka || "",
          district: addr?.district || "", state: addr?.state || "" }}
        nominee={{ name: nominee?.name || "", relation: nominee?.relation || "",
          mobile: nominee?.mobile || "" }} />
    </Shell>);
}
