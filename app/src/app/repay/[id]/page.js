import Shell from "@/components/Shell.js";
import RepayClient from "./RepayClient.js";
import RemarkPopup from "@/components/RemarkPopup.js";
import { one } from "@/lib/db.js";

export const dynamic = "force-dynamic";

export default async function RepayPage({ params }) {
  const { id } = await params;
  // E32 №5: the customer's standing remark greets the operator before any money moves
  const c = await one(`SELECT c.full_name, c.cust_no, c.warning_remark, c.blacklist_remark
                         FROM loan l JOIN customer c ON c.id = l.customer_id WHERE l.id = $1`, [Number(id)]).catch(() => null);
  const entries = c ? [
    c.blacklist_remark ? { kind: "blacklist", name: c.full_name, custNo: c.cust_no, remark: c.blacklist_remark } : null,
    c.warning_remark ? { kind: "warning", name: c.full_name, custNo: c.cust_no, remark: c.warning_remark } : null,
  ].filter(Boolean) : [];
  return <Shell><RemarkPopup entries={entries} /><RepayClient loanId={Number(id)} /></Shell>;
}
