import test from "node:test";
import assert from "node:assert/strict";
import { canAccessExport, hashDownloadToken, safeExportAttributes } from "../service/dataExportService.js";

test("permite somente o tenant autenticado acessar a exportação", () => {
  const job = { usersId: "tenant-a" };
  assert.equal(canAccessExport(job, { establishment: "tenant-a" }), true);
  assert.equal(canAccessExport(job, { establishment: "tenant-b" }), false);
  assert.equal(canAccessExport(job, { establishment: "../tenant-a" }), false);
});

test("não exporta campos sensíveis nem o identificador técnico do tenant", () => {
  const fakeModel = { rawAttributes: { id: {}, usersId: {}, name: {}, password: {}, refreshToken: {}, apiKey: {}, notes: {}, metadata: {} } };
  assert.deepEqual(safeExportAttributes(fakeModel), ["id", "name", "notes"]);
});

test("tokens de download são armazenados somente como hash", () => {
  const first = hashDownloadToken("token-com-acentuação-ç");
  const second = hashDownloadToken("token-com-acentuação-ç");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, "token-com-acentuação-ç");
});
