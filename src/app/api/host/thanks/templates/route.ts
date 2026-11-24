import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { TemplateInput, setTemplate } from "@/domain/thanks/service";

export const dynamic = "force-dynamic";

export const PUT = handle(async (req: Request) => {
  const s = await requireSelected("thanks.manage");
  const { variant, body } = await parseBody(req, TemplateInput);
  return json(await setTemplate(s, variant, body));
});
