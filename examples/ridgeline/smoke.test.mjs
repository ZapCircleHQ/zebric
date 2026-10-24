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

test("ridgeline seeded journeys", { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zebric-ridgeline-"));
  const dbPath = join(dir, "app.db");
  const port = Number(process.env.SMOKE_PORT || 4930);
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
      password: "RidgelineDemo1!",
    });
    assert.equal(response.status, 200, await response.text());
    return request;
  };
  const action = async (
    request,
    name,
    entity,
    recordId,
    page,
    payload = {},
    succeeds = true,
  ) => {
    const response = await request(`/actions/${name}`, {
      entity,
      recordId,
      page,
      payload,
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
      if (stored?.status === "completed") {
        assert.ok(succeeds, `${name} unexpectedly accepted a forged account`);
        return;
      }
      if (!succeeds && stored?.status === "failed") return;
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
        DEMO_PASSWORD: "RidgelineDemo1!",
      },
    });
    // Simulate the ownership-table upgrade on an existing seeded database.
    // Reseeding must restore explicit demo memberships without duplicating data.
    execFileSync("sqlite3", [dbPath, "DELETE FROM customer_membership"]);
    await run("bash", [fileURLToPath(new URL("./seed.sh", import.meta.url))], {
      env: {
        ...process.env,
        BASE_URL: base,
        DB_PATH: dbPath,
        DEMO_PASSWORD: "RidgelineDemo1!",
      },
    });
    assert.equal(rows("SELECT count(*) AS n FROM customer_membership")[0].n, 4);
    assert.equal(rows("SELECT count(*) AS n FROM sales_order")[0].n, 6);
    const admin = await signIn("admin@ridgelinecoffee.com");
    for (const path of [
      "/",
      "/orders",
      "/orders/ord_pending",
      "/roasting",
      "/inventory",
      "/accounts",
      "/subscriptions",
      "/shipping",
    ]) {
      const response = await admin(path);
      assert.equal(response.status, 200, path);
      assert.ok(
        !(await response.text()).includes("Template rendering error"),
        path,
      );
    }
    const bypass = await admin(
      "/api/salesorders/ord_pending",
      { status: "delivered" },
      "PUT",
    );
    assert.ok(bypass.status >= 400, "CRUD must not mutate protected status");
    await action(
      admin,
      "ConfirmOrder",
      "SalesOrder",
      "ord_pending",
      "/orders/:id",
    );
    assert.equal(
      rows("SELECT status FROM sales_order WHERE id = 'ord_pending'")[0].status,
      "confirmed",
    );
    assert.equal(
      rows("SELECT status FROM shipment WHERE order_id = 'ord_pending'")[0]
        .status,
      "ready",
    );
    const customer = await signIn("orders@northsidecafe.com");
    const denied = await customer("/actions/StartRoastingForOrder", {
      entity: "SalesOrder",
      recordId: "ord_pending",
      page: "/orders/:id",
    });
    assert.equal(denied.status, 403);
    const foreign = await customer("/api/orderitems");
    const items = await foreign.json();
    assert.ok(items.length > 0);
    assert.ok(
      items.every(
        (item) =>
          rows(
            `SELECT customer_id FROM sales_order WHERE id = '${item.orderId}'`,
          )[0].customer_id === "cust_northside",
      ),
    );
    await action(
      customer,
      "CreateOrderWithItems",
      "SalesOrder",
      undefined,
      "/orders/new",
      {
        customerId: "cust_northside",
        customerEmail: "orders@northsidecafe.com",
        orderType: "retail",
        requestedShipDate: "2026-10-21",
        dueDate: "2026-10-24",
        notes: "Smoke order",
        shippingMethod: "ups",
        items: [{ productId: "prod_reserve", quantity: 2, unitPrice: 145 }],
        shipments: [{ loadNumber: 1, cases: 2 }],
      },
    );
    assert.equal(
      rows("SELECT id FROM sales_order WHERE notes = 'Smoke order'").length,
      1,
    );
    assert.equal(
      rows("SELECT order_type FROM sales_order WHERE notes = 'Smoke order'")[0]
        .order_type,
      "wholesale",
    );
    const countBefore = rows("SELECT count(*) AS n FROM sales_order")[0].n;
    await action(
      customer,
      "CreateOrderWithItems",
      "SalesOrder",
      undefined,
      "/orders/new",
      {
        customerId: "cust_jsmith",
        customerEmail: "orders@northsidecafe.com",
        notes: "Forged workflow",
        orderType: "wholesale",
        items: [],
        shipments: [],
      },
      false,
    );
    assert.equal(
      rows("SELECT count(*) AS n FROM sales_order")[0].n,
      countBefore,
    );
    const deniedWrites = [
      [
        "/api/salesorders",
        {
          customerId: "cust_jsmith",
          customerEmail: "orders@northsidecafe.com",
          orderType: "retail",
        },
      ],
      [
        "/api/subscriptions",
        {
          customerId: "cust_jsmith",
          productId: "prod_reserve",
          customerEmail: "orders@northsidecafe.com",
        },
      ],
      [
        "/api/orderitems",
        {
          orderId: "ord_roasting",
          productId: "prod_reserve",
          quantity: 1,
          unitPrice: 1,
          customerEmail: "orders@northsidecafe.com",
        },
      ],
      [
        "/api/shipments",
        {
          orderId: "ord_roasting",
          method: "ups",
          customerEmail: "orders@northsidecafe.com",
        },
      ],
      [
        "/api/shipments",
        {
          orderId: "ord_pending",
          method: "delivery_truck",
          warehouseId: "wh_harbor_main",
        },
      ],
    ];
    for (const [path, body] of deniedWrites) {
      assert.ok((await customer(path, body)).status >= 400, path);
    }
    const userId = rows(
      "SELECT id FROM user WHERE email = 'orders@northsidecafe.com'",
    )[0].id;
    const injected = await customer("/api/subscriptions", {
      customerId: "cust_jsmith",
      productId: "prod_reserve",
      customer: { id: "cust_jsmith", memberships: [{ userId }] },
    });
    assert.ok(
      injected.status >= 400,
      "embedded customer/memberships must not authorize writes",
    );
    assert.ok(
      (
        await customer("/api/customermemberships", {
          customerId: "cust_jsmith",
          userId,
        })
      ).status >= 400,
    );
    assert.equal((await customer("/api/salesorders/ord_roasting")).status, 404);
    assert.ok((await customer("/api/orderitems")).ok);
    const subscriber = await signIn("jsmith@example.com");
    assert.ok(
      (
        await subscriber(
          "/api/subscriptions/sub_jsmith",
          { customerId: "cust_northside" },
          "PUT",
        )
      ).status >= 400,
    );
    assert.equal(
      rows("SELECT customer_id FROM subscription WHERE id = 'sub_jsmith'")[0]
        .customer_id,
      "cust_jsmith",
    );
    await action(
      subscriber,
      "CreateSubscription",
      "Subscription",
      undefined,
      "/subscriptions/new",
      {
        customerId: "cust_northside",
        customerEmail: "jsmith@example.com",
        productId: "prod_reserve",
        frequency: "monthly",
        quantity: 1,
      },
      false,
    );
    await action(
      subscriber,
      "CreateSubscription",
      "Subscription",
      undefined,
      "/subscriptions/new",
      {
        customerId: "cust_jsmith",
        customerEmail: "jsmith@example.com",
        productId: "prod_reserve",
        frequency: "monthly",
        quantity: 1,
        nextShipDate: "2026-11-01",
      },
    );
    assert.equal(
      rows("SELECT id FROM subscription WHERE next_ship_date = '2026-11-01'")
        .length,
      1,
    );
    await action(
      subscriber,
      "PauseSubscription",
      "Subscription",
      "sub_jsmith",
      "/subscriptions",
    );
    assert.equal(
      rows("SELECT status FROM subscription WHERE id = 'sub_jsmith'")[0].status,
      "paused",
    );
    await action(
      subscriber,
      "ResumeSubscription",
      "Subscription",
      "sub_jsmith",
      "/subscriptions",
      { nextShipDate: "2026-11-15" },
    );
    assert.equal(
      rows("SELECT next_ship_date FROM subscription WHERE id = 'sub_jsmith'")[0]
        .next_ship_date,
      "2026-11-15",
    );
    await action(
      subscriber,
      "CancelSubscription",
      "Subscription",
      "sub_jsmith",
      "/subscriptions",
    );
    assert.equal(
      rows("SELECT status FROM subscription WHERE id = 'sub_jsmith'")[0].status,
      "cancelled",
    );
    const contact = await admin(
      "/api/customers/cust_northside",
      { email: "jsmith@example.com" },
      "PUT",
    );
    assert.ok(contact.ok);
    execFileSync("sqlite3", [
      dbPath,
      "UPDATE user SET email = 'northside-new@example.com' WHERE email = 'orders@northsidecafe.com'",
    ]);
    const renamed = await signIn("northside-new@example.com");
    assert.equal((await renamed("/api/salesorders/ord_pending")).status, 200);
    assert.equal(
      (await subscriber("/api/salesorders/ord_pending")).status,
      404,
      "contact email must not grant ownership",
    );
    const secondUser = rows(
      "SELECT id FROM user WHERE email = 'orders@mapleandco.ca'",
    )[0].id;
    const grant = await admin("/api/customermemberships", {
      id: "test-shared-account",
      customerId: "cust_northside",
      userId: secondUser,
    });
    assert.ok(grant.ok, await grant.text());
    const shared = await signIn("orders@mapleandco.ca");
    assert.equal((await shared("/api/salesorders/ord_pending")).status, 200);
    const revoke = await admin(
      "/api/customermemberships/test-shared-account",
      {},
      "DELETE",
    );
    assert.ok(revoke.ok);
    assert.equal(
      (await shared("/api/salesorders/ord_pending")).status,
      404,
      "revocation applies to existing sessions",
    );
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
