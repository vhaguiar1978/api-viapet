import { enqueueInboundResponseJob } from "../crmResponseQueue.js";

// The durable queue owns debounce, retries and operational monitoring.
export async function scheduleMetaAutoReply({
  companyId,
  conversation,
  inboundMessage,
  phone,
}) {
  return enqueueInboundResponseJob({
    usersId: companyId,
    conversation,
    inboundMessage,
    sourceChannel: "official",
    phone,
  });
}
