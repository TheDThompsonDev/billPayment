import { db } from "@/database/client";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function GET(
  request: Request,
  { params }: { params: Promise<{ layout: string }> },
) {
  const { layout } = await params;
  if (!["classic", "compact"].includes(layout))
    return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const id = url.searchParams.get("bill");
  const bill = id
    ? await db.bill.findUnique({
        where: { id },
        include: { vendor: true, navigation: true },
      })
    : null;
  const active =
    bill &&
    request.headers.get("x-dsd-run-token") === bill.navigation?.runToken;
  const vendor = active
    ? bill.vendor?.name || "Vendor"
    : "Vendor payment simulator";
  const compact = layout === "compact";
  const content = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(vendor)} · Payments</title><style>body{margin:0;background:${compact ? "#f3eddf" : "#eef3f4"};color:#193e3b;font:16px Georgia,serif}header{padding:24px 7%;border-bottom:1px solid #c9d6ce;display:flex;justify-content:space-between}header small{font:12px Arial;letter-spacing:2px}main{max-width:640px;margin:70px auto;padding:40px;background:#fff;border:1px solid #d5ddd6;border-radius:${compact ? "0" : "20px"}}h1{font-size:38px;font-weight:400;margin:0 0 16px}p{line-height:1.6}label{display:block;margin:20px 0;font:14px Arial}input{box-sizing:border-box;display:block;width:100%;padding:14px;margin-top:8px;border:1px solid #adbdb7;border-radius:5px;font:17px Arial}button{cursor:pointer;padding:16px 24px;border:0;border-radius:6px;background:#23594b;color:white;font:600 15px Arial}dl div{display:flex;justify-content:space-between;padding:16px 0;border-bottom:1px solid #ddd}dd{margin:0}aside{font:12px Arial;color:#667b73;margin-top:30px}a{color:#23594b}</style></head><body><header><b>${escape(vendor)}</b><small>LOCAL SIMULATION · NO REAL MONEY</small></header><main id="content"><p>ACCOUNT SERVICES</p><h1>${compact ? "Your account. Taken care of." : "Let’s take care of your bill."}</h1><p>A separate payment website for demonstrating browser navigation, account lookup, review and receipt capture.</p>${active ? `<button id="begin">${compact ? "Make a payment" : "Pay your bill"}</button>` : "<p>Start a browser payment from an approved DSD invoice to use this portal.</p>"}<aside>This is a local payment simulator, not a financial institution.</aside></main><script>
const billId=${JSON.stringify(active ? id : null)};let details;
const root=document.getElementById('content');
const begin=document.getElementById('begin');
if(begin)begin.onclick=()=>{root.innerHTML='<h1>${compact ? "Find your statement" : "Account lookup"}</h1><form id="lookup"><label>${compact ? "Customer account number" : "Account number"}<input name="account" required></label><label>Invoice number<input name="invoice" required></label><button>${compact ? "Continue" : "Look up account"}</button></form><p id="error" role="alert"></p>';document.getElementById('lookup').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/payment-demo/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({billId,account:f.get('account'),invoice:f.get('invoice')})});const data=await r.json();if(!r.ok){document.getElementById('error').textContent=data.error;return;}details=data;review();};};
function review(){root.innerHTML='<p>REVIEW PAYMENT</p><h1>One last look.</h1><dl><div><dt>Account number</dt><dd id="account"></dd></div><div><dt>Invoice number</dt><dd id="invoice"></dd></div><div><dt>Total payment</dt><dd id="amount"></dd></div><div><dt>Funding source</dt><dd>Demo operating account · 0042</dd></div></dl><p>No fees. One payment only. No autopay enrollment.</p><button id="pay">${compact ? "Submit payment" : "Confirm and pay"}</button><p id="error" role="alert"></p>';document.getElementById('account').textContent=details.account;document.getElementById('invoice').textContent=details.invoice;document.getElementById('amount').textContent='$'+(details.amountCents/100).toFixed(2);document.getElementById('pay').onclick=async()=>{const r=await fetch('/api/payment-demo/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({billId,...details})});const data=await r.json();if(!r.ok){document.getElementById('error').textContent=data.error;return;}root.innerHTML='<p>PAYMENT COMPLETE</p><h1>Thank you. You’re all set.</h1><p id="receipt"></p><p id="summary"></p><p id="invoice"></p><aside>Simulated payment. No funds moved.</aside>';document.getElementById('receipt').textContent='Receipt reference: '+data.receipt;document.getElementById('summary').textContent='Account '+details.account+' · $'+(details.amountCents/100).toFixed(2);document.getElementById('invoice').textContent=details.invoice;};}
</script></body></html>`;
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    },
  });
}
