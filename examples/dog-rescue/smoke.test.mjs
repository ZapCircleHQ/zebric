import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ZebricEngine } from "@zebric/runtime-node";

const run = promisify(execFile);

test("dog-rescue seeded journeys", { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zebric-dog-rescue-"));
  const dbPath = join(dir, "app.db");
  const port = Number(process.env.SMOKE_PORT || 4931);
  const base = `http://127.0.0.1:${port}`;
  const engine = new ZebricEngine({
    blueprintPath: fileURLToPath(new URL("./blueprint.toml", import.meta.url)),
    host: "127.0.0.1",
    port,
    dev: {
      adminPort: port + 30,
      dbPath,
      hotReload: false,
      logLevel: "error",
      rateLimit: { max: 10000, windowMs: 1000 },
    },
  });
  const rows = (sql) =>
    JSON.parse(
      execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }) ||
        "[]",
    );
  const client = () => {
    const cookies = new Map([["csrf-token", "example-smoke"]]);
    return async (path, body, method = "POST") => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : method,
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          Origin: base,
          "x-csrf-token": "example-smoke",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [key, ...value] = cookie.split(";")[0].split("=");
        cookies.set(key, value.join("="));
      }
      return response;
    };
  };
  const signIn = async (email) => {
    const request = client();
    const response = await request("/api/auth/sign-in/email", {
      email,
      password: "FriendlyPaws!Demo1",
    });
    assert.equal(response.status, 200, await response.text());
    return request;
  };
  const action = async (request, name, entity, recordId, page) => {
    const response = await request(`/actions/${name}`, {
      entity,
      recordId,
      page,
    });
    assert.ok(
      response.ok,
      `${name}: ${response.status} ${response.ok ? "" : await response.text()}`,
    );
    const { job } = await response.json();
    for (let attempt = 0; attempt < 100; attempt++) {
      const stored = rows(
        `SELECT status, job_json FROM __zbl_workflow_jobs WHERE id = '${job.id}'`,
      )[0];
      if (stored?.status === "completed") return;
      assert.ok(
        !["failed", "cancelled"].includes(stored?.status),
        stored?.job_json,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`${name} did not complete`);
  };
  try {
    await engine.start();
    await run("bash", [fileURLToPath(new URL("./seed.sh", import.meta.url))], {
      env: {
        ...process.env,
        BASE: base,
        BASE_URL: base,
        DB_PATH: dbPath,
        DEMO_PASSWORD: "FriendlyPaws!Demo1",
      },
    });
    const publicRequest = client();
    assert.equal((await publicRequest("/dogs")).status, 200);
    assert.equal((await publicRequest("/applications")).status, 401);
    const dog = rows("SELECT id FROM dog WHERE name = 'Cooper'")[0];
    const submission = await publicRequest("/api/adoptioninterests", {
      dogId: dog.id,
      firstName: "Smoke",
      lastName: "Applicant",
      email: "smoke@example.com",
      ownsOrRents: "Rents",
      hasExistingPets: true,
      existingDogsCount: 1,
      existingCatsCount: 0,
    });
    assert.ok(submission.ok, await submission.text());
    let application;
    for (let attempt = 0; attempt < 100; attempt++) {
      application = rows(
        `SELECT * FROM adoption_application WHERE dog_id = '${dog.id}'`,
      )[0];
      if (
        application &&
        rows(
          `SELECT id FROM workflow_execution WHERE related_entity_id = '${application.id}'`,
        ).length
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(application?.status, "Meet & Greet Required");
    const messages = rows(
      `SELECT * FROM outgoing_message WHERE related_entity_id = '${application.id}'`,
    );
    assert.equal(messages.length, 2);
    assert.ok(messages.every((message) => message.subject.includes("Cooper")));
    assert.equal(
      rows(`SELECT * FROM task WHERE related_entity_id = '${application.id}'`)
        .length,
      2,
    );
    const volunteer = await signIn("maya@friendlypaws.example");
    const denied = await volunteer("/actions/ApproveApplication", {
      entity: "AdoptionApplication",
      recordId: application.id,
      page: "/applications/:id",
    });
    assert.equal(denied.status, 403);
    const submitted = rows(
      "SELECT id FROM adoption_application WHERE status = 'Submitted'",
    )[0];
    await action(
      volunteer,
      "ReviewApplication",
      "AdoptionApplication",
      submitted.id,
      "/applications/:id",
    );
    const reviewer = rows(
      "SELECT id FROM volunteer WHERE email = 'maya@friendlypaws.example'",
    )[0];
    assert.equal(
      rows(
        `SELECT reviewed_by FROM adoption_application WHERE id = '${submitted.id}'`,
      )[0].reviewed_by,
      reviewer.id,
    );
    const coordinator = await signIn("eli@friendlypaws.example");
    await action(
      coordinator,
      "ApproveApplication",
      "AdoptionApplication",
      application.id,
      "/applications/:id",
    );
    const approval = rows(
      `SELECT * FROM outgoing_message WHERE related_entity_id = '${application.id}' AND template = 'approval-email'`,
    )[0];
    assert.equal(approval.to_email, "smoke@example.com");
    assert.ok(approval.subject.includes("Cooper"));
    assert.equal(
      rows(`SELECT status FROM dog WHERE id = '${dog.id}'`)[0].status,
      "Pending Pickup",
    );
    await action(
      coordinator,
      "CompleteAdoption",
      "AdoptionApplication",
      application.id,
      "/applications/:id",
    );
    assert.equal(
      rows(`SELECT status FROM dog WHERE id = '${dog.id}'`)[0].status,
      "Adopted",
    );
    const welcome = rows(
      `SELECT to_email FROM outgoing_message WHERE related_entity_id = '${application.id}' AND template = 'welcome-packet'`,
    )[0];
    assert.equal(welcome.to_email, "smoke@example.com");
    for (const path of [
      "/",
      "/applications",
      "/tasks",
      "/messages",
      "/activity",
      "/workflow-history",
      "/applicants",
      "/volunteers",
    ]) {
      assert.equal((await coordinator(path)).status, 200, path);
    }
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
