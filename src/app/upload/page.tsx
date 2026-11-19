import { PageHeading } from "@/components/page-heading";
import { UploadForm } from "@/components/upload-form";
export default function Upload() {
  return (
    <>
      <PageHeading
        eyebrow="FROM DOCUMENT TO DECISION"
        title="Bring a bill into the workflow."
        description="Upload an invoice, enter the details, or explore one of the demonstration scenarios."
        action={false}
      />
      <UploadForm
        aiEnabled={
          !!process.env.OPENAI_API_KEY &&
          process.env.BILL_EXTRACTION_MODE !== "offline"
        }
        offlineMode={process.env.BILL_EXTRACTION_MODE === "offline"}
      />
    </>
  );
}
