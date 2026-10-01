#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-RidgelineDemo1!}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/data/app.db}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
CSRF_TOKEN="${CSRF_TOKEN:-ridgeline-seed-csrf}"

post_json() {
  curl -fsS -X POST "$BASE_URL$1" -b "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

post_auth() {
  curl -sS -X POST "$BASE_URL$1" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "Origin: $BASE_URL" -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

echo "Provisioning Ridgeline demo identities..."
post_auth /api/auth/sign-up/email "{\"email\":\"admin@ridgelinecoffee.com\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Morgan Reyes\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"maria@ridgelinecoffee.com\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Maria Torres\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"devon@ridgelinecoffee.com\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Devon Ellis\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"orders@northsidecafe.com\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Northside Cafe\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"orders@mapleandco.ca\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Maple & Co\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"jsmith@example.com\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"J. Smith\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"ana.ruiz@example.com\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Ana Ruiz\"}" >/dev/null || true

sqlite3 "$DB_PATH" <<SQL
UPDATE user SET role = 'admin' WHERE email = 'admin@ridgelinecoffee.com';
UPDATE user SET role = 'staff' WHERE email = 'maria@ridgelinecoffee.com';
UPDATE user SET role = 'staff' WHERE email = 'devon@ridgelinecoffee.com';
UPDATE user SET role = 'customer' WHERE email = 'orders@northsidecafe.com';
UPDATE user SET role = 'customer' WHERE email = 'orders@mapleandco.ca';
UPDATE user SET role = 'customer' WHERE email = 'jsmith@example.com';
UPDATE user SET role = 'customer' WHERE email = 'ana.ruiz@example.com';
SQL

post_auth /api/auth/sign-in/email "{\"email\":\"admin@ridgelinecoffee.com\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null

if curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/customers" | grep -q 'cust_northside'; then
  echo "Ridgeline demo data already exists; leaving it unchanged."
  exit 0
fi

echo "Creating accounts..."
post_json /api/customers '{"id":"cust_northside","name":"Northside Cafe","type":"wholesale","email":"orders@northsidecafe.com","phone":"412-555-0110","address":"118 Butler St","city":"Pittsburgh","state":"PA","country":"USA","currency":"USD"}' >/dev/null
post_json /api/customers '{"id":"cust_mapleandco","name":"Maple & Co","type":"wholesale","email":"orders@mapleandco.ca","phone":"416-555-0199","address":"22 King St W","city":"Toronto","state":"ON","country":"Canada","currency":"CAD"}' >/dev/null
post_json /api/customers '{"id":"cust_harbor","name":"Harbor Hotel Group","type":"wholesale","email":"purchasing@harborhotels.com","phone":"206-555-0142","address":"900 Alaskan Way","city":"Seattle","state":"WA","country":"USA","currency":"USD"}' >/dev/null
post_json /api/customers '{"id":"cust_jsmith","name":"J. Smith","type":"retail","email":"jsmith@example.com","city":"Denver","state":"CO","country":"USA","currency":"USD"}' >/dev/null
post_json /api/customers '{"id":"cust_anaruiz","name":"Ana Ruiz","type":"retail","email":"ana.ruiz@example.com","city":"Austin","state":"TX","country":"USA","currency":"USD"}' >/dev/null

# A customer login is linked to its account by matching email address (Better
# Auth's `user` table can't carry a custom customerId column -- see
# ZEBRIC_GAPS.md G-04), so no separate linking step is needed: each account
# above was seeded with the same email its login signed up with.

echo "Creating warehouses and trucking services..."
post_json /api/warehouses '{"id":"wh_northside_main","customerId":"cust_northside","name":"Northside Cafe Loading Dock","address":"118 Butler St","city":"Pittsburgh","state":"PA","country":"USA","serviceArea":"in_state"}' >/dev/null
post_json /api/warehouses '{"id":"wh_harbor_main","customerId":"cust_harbor","name":"Harbor Hotels Central Receiving","address":"900 Alaskan Way","city":"Seattle","state":"WA","country":"USA","serviceArea":"local"}' >/dev/null
post_json /api/truckingservices '{"id":"svc_local","name":"Cascade Local Freight","serviceArea":"local","capacityCases":40,"liftgate":true,"appointmentDelivery":false,"active":true}' >/dev/null
post_json /api/truckingservices '{"id":"svc_regional","name":"Keystone Regional Lines","serviceArea":"in_state","capacityCases":100,"liftgate":true,"appointmentDelivery":true,"active":true}' >/dev/null

echo "Creating products..."
post_json /api/products '{"id":"prod_reserve","sku":"RC-RES-01","name":"Ridgeline Reserve","origin":"Ethiopia","process":"washed","roastLevel":"light","wholesalePricePerCase":145.00,"retailPricePerBag":18.00,"bagWeightG":340,"casesInStock":22,"bagsInStock":140,"active":true}' >/dev/null
post_json /api/products '{"id":"prod_foothills","sku":"RC-FOOT-01","name":"Foothills Blend","origin":"Colombia","process":"washed","roastLevel":"medium","wholesalePricePerCase":128.00,"retailPricePerBag":15.50,"bagWeightG":340,"casesInStock":4,"bagsInStock":58,"active":true}' >/dev/null
post_json /api/products '{"id":"prod_summit","sku":"RC-SUM-01","name":"Summit Dark","origin":"Sumatra","process":"natural","roastLevel":"dark","wholesalePricePerCase":132.00,"retailPricePerBag":16.00,"bagWeightG":340,"casesInStock":15,"bagsInStock":90,"active":true}' >/dev/null

echo "Creating green coffee lots..."
post_json /api/greencoffeelots '{"id":"lot_ethiopia_01","lotCode":"ETH-2601","origin":"Ethiopia","farmOrCoop":"Yirgacheffe Cooperative","process":"washed","arrivalDate":"2026-08-02","weightKgReceived":300.00,"weightKgRemaining":210.00,"costPerKgUsd":7.20,"supplierCurrency":"USD"}' >/dev/null
post_json /api/greencoffeelots '{"id":"lot_colombia_01","lotCode":"COL-2604","origin":"Colombia","farmOrCoop":"Finca La Esperanza","process":"washed","arrivalDate":"2026-07-18","weightKgReceived":400.00,"weightKgRemaining":48.00,"costPerKgUsd":6.10,"supplierCurrency":"USD"}' >/dev/null
post_json /api/greencoffeelots '{"id":"lot_sumatra_01","lotCode":"SUM-2602","origin":"Sumatra","farmOrCoop":"Lintong Growers Group","process":"natural","arrivalDate":"2026-08-20","weightKgReceived":250.00,"weightKgRemaining":180.00,"costPerKgUsd":6.80,"supplierCurrency":"USD"}' >/dev/null

echo "Logging roast batches..."
post_json /api/roastbatchs '{"id":"batch_eth_01","lotId":"lot_ethiopia_01","productId":"prod_reserve","roastDate":"2026-09-10","greenWeightKg":60.00,"roastedWeightKg":49.80,"roastLevel":"light","roastedBy":"Maria Torres"}' >/dev/null
post_json /api/roastbatchs '{"id":"batch_col_01","lotId":"lot_colombia_01","productId":"prod_foothills","roastDate":"2026-09-18","greenWeightKg":80.00,"roastedWeightKg":66.40,"roastLevel":"medium","roastedBy":"Devon Ellis"}' >/dev/null
post_json /api/roastbatchs '{"id":"batch_sum_01","lotId":"lot_sumatra_01","productId":"prod_summit","roastDate":"2026-09-24","greenWeightKg":50.00,"roastedWeightKg":40.10,"roastLevel":"dark","roastedBy":"Maria Torres"}' >/dev/null

echo "Creating orders..."
post_json /api/salesorders '{"id":"ord_pending","customerId":"cust_northside","customerEmail":"orders@northsidecafe.com","orderType":"wholesale","requestedShipDate":"2026-10-05","dueDate":"2026-10-08","notes":"Standing weekly order."}' >/dev/null
post_json /api/orderitems '{"id":"item_pending_1","orderId":"ord_pending","customerEmail":"orders@northsidecafe.com","productId":"prod_reserve","quantity":6,"unitPrice":145.00}' >/dev/null
post_json /api/orderitems '{"id":"item_pending_2","orderId":"ord_pending","customerEmail":"orders@northsidecafe.com","productId":"prod_foothills","quantity":4,"unitPrice":128.00}' >/dev/null
post_json /api/shipments '{"id":"ship_pending","orderId":"ord_pending","customerEmail":"orders@northsidecafe.com","method":"ups","scheduledShipDate":"2026-10-05"}' >/dev/null

post_json /api/salesorders '{"id":"ord_confirmed","customerId":"cust_anaruiz","customerEmail":"ana.ruiz@example.com","orderType":"retail","requestedShipDate":"2026-09-30","dueDate":"2026-10-03"}' >/dev/null
post_json /api/orderitems '{"id":"item_confirmed_1","orderId":"ord_confirmed","customerEmail":"ana.ruiz@example.com","productId":"prod_summit","quantity":3,"unitPrice":16.00}' >/dev/null
post_json /api/shipments '{"id":"ship_confirmed","orderId":"ord_confirmed","customerEmail":"ana.ruiz@example.com","method":"usps","scheduledShipDate":"2026-09-30"}' >/dev/null

post_json /api/salesorders '{"id":"ord_roasting","customerId":"cust_jsmith","customerEmail":"jsmith@example.com","orderType":"retail","requestedShipDate":"2026-09-29","dueDate":"2026-10-02"}' >/dev/null
post_json /api/orderitems '{"id":"item_roasting_1","orderId":"ord_roasting","customerEmail":"jsmith@example.com","productId":"prod_reserve","quantity":2,"unitPrice":18.00}' >/dev/null
post_json /api/shipments '{"id":"ship_roasting","orderId":"ord_roasting","customerEmail":"jsmith@example.com","method":"fedex","scheduledShipDate":"2026-09-29"}' >/dev/null

post_json /api/salesorders '{"id":"ord_shipped","customerId":"cust_mapleandco","customerEmail":"orders@mapleandco.ca","orderType":"wholesale","requestedShipDate":"2026-09-22","dueDate":"2026-09-26"}' >/dev/null
post_json /api/orderitems '{"id":"item_shipped_1","orderId":"ord_shipped","customerEmail":"orders@mapleandco.ca","productId":"prod_summit","quantity":10,"unitPrice":132.00}' >/dev/null
post_json /api/shipments '{"id":"ship_shipped","orderId":"ord_shipped","customerEmail":"orders@mapleandco.ca","method":"fedex","scheduledShipDate":"2026-09-22","trackingNumber":"FX-88213199"}' >/dev/null

post_json /api/salesorders '{"id":"ord_delivered","customerId":"cust_northside","customerEmail":"orders@northsidecafe.com","orderType":"wholesale","requestedShipDate":"2026-09-10","dueDate":"2026-09-13"}' >/dev/null
post_json /api/orderitems '{"id":"item_delivered_1","orderId":"ord_delivered","customerEmail":"orders@northsidecafe.com","productId":"prod_reserve","quantity":8,"unitPrice":145.00}' >/dev/null
post_json /api/shipments '{"id":"ship_delivered","orderId":"ord_delivered","customerEmail":"orders@northsidecafe.com","method":"ups","scheduledShipDate":"2026-09-10","trackingNumber":"1Z999AA10123456784"}' >/dev/null

echo "Creating a capacity-split truck order..."
post_json /api/salesorders '{"id":"ord_truck","customerId":"cust_harbor","customerEmail":"purchasing@harborhotels.com","orderType":"wholesale","requestedShipDate":"2026-10-01","dueDate":"2026-10-06","notes":"Two-load delivery: 260 cases at 100/load."}' >/dev/null
post_json /api/orderitems '{"id":"item_truck_1","orderId":"ord_truck","customerEmail":"purchasing@harborhotels.com","productId":"prod_reserve","quantity":140,"unitPrice":145.00}' >/dev/null
post_json /api/orderitems '{"id":"item_truck_2","orderId":"ord_truck","customerEmail":"purchasing@harborhotels.com","productId":"prod_summit","quantity":120,"unitPrice":132.00}' >/dev/null
post_json /api/shipments '{"id":"ship_truck_1","orderId":"ord_truck","customerEmail":"purchasing@harborhotels.com","method":"delivery_truck","scheduledShipDate":"2026-10-01","truckingServiceId":"svc_regional","warehouseId":"wh_harbor_main","loadNumber":1,"cases":100}' >/dev/null
post_json /api/shipments '{"id":"ship_truck_2","orderId":"ord_truck","customerEmail":"purchasing@harborhotels.com","method":"delivery_truck","scheduledShipDate":"2026-10-01","truckingServiceId":"svc_regional","warehouseId":"wh_harbor_main","loadNumber":2,"cases":100}' >/dev/null
post_json /api/shipments '{"id":"ship_truck_3","orderId":"ord_truck","customerEmail":"purchasing@harborhotels.com","method":"delivery_truck","scheduledShipDate":"2026-10-01","truckingServiceId":"svc_regional","warehouseId":"wh_harbor_main","loadNumber":3,"cases":60}' >/dev/null

echo "Creating subscriptions..."
post_json /api/subscriptions '{"id":"sub_jsmith","customerId":"cust_jsmith","customerEmail":"jsmith@example.com","productId":"prod_reserve","frequency":"monthly","quantity":2,"nextShipDate":"2026-10-15"}' >/dev/null
post_json /api/subscriptions '{"id":"sub_anaruiz","customerId":"cust_anaruiz","customerEmail":"ana.ruiz@example.com","productId":"prod_summit","frequency":"biweekly","quantity":1,"nextShipDate":"2026-10-08"}' >/dev/null
post_json /api/subscriptions '{"id":"sub_jsmith_paused","customerId":"cust_jsmith","customerEmail":"jsmith@example.com","productId":"prod_foothills","frequency":"weekly","quantity":1}' >/dev/null

# Fixture setup is trusted test infrastructure. Populate non-default lifecycle
# snapshots directly; application users still cannot bypass domain commands.
sqlite3 "$DB_PATH" <<SQL
UPDATE sales_order SET status = 'confirmed' WHERE id IN ('ord_confirmed','ord_truck');
UPDATE sales_order SET status = 'roasting' WHERE id = 'ord_roasting';
UPDATE sales_order SET status = 'shipped' WHERE id = 'ord_shipped';
UPDATE sales_order SET status = 'delivered' WHERE id = 'ord_delivered';
UPDATE shipment SET status = 'ready' WHERE id IN ('ship_confirmed','ship_roasting','ship_truck_1','ship_truck_2','ship_truck_3');
UPDATE shipment SET status = 'in_transit' WHERE id = 'ship_shipped';
UPDATE shipment SET status = 'delivered' WHERE id = 'ship_delivered';
UPDATE subscription SET status = 'paused' WHERE id = 'sub_jsmith_paused';
SQL

echo "Ridgeline Coffee is ready at $BASE_URL"
echo "Demo password for every account: $DEMO_PASSWORD"
echo "  admin     admin@ridgelinecoffee.com"
echo "  staff     maria@ridgelinecoffee.com"
echo "  staff     devon@ridgelinecoffee.com"
echo "  customer  orders@northsidecafe.com (Northside Cafe, wholesale)"
echo "  customer  orders@mapleandco.ca (Maple & Co, wholesale, CAD)"
echo "  customer  jsmith@example.com (retail, active + paused subscriptions)"
echo "  customer  ana.ruiz@example.com (retail, active subscription)"
echo "Capacity-split truck order: $BASE_URL/orders/ord_truck"
echo "Low green-coffee lot: $BASE_URL/inventory (COL-2604)"
