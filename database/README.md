# MySQL database setup

To create the `gauteng_health_assets` database on a MySQL/MariaDB server, run
[`create-gauteng-health-assets.sql`](./create-gauteng-health-assets.sql) with an
administrative database account. This only creates the database; it does not
create a database user, grant privileges, configure Cloudflare Tunnel, or deploy
the gateway service.

The app uses a server-side MySQL connection for asset listing, creation, updates,
and deletion. Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and
`DB_NAME` in `.env.local` for local development and as server environment
variables in production. Do not expose these values with `NEXT_PUBLIC_` names.
For the Vercel deployment, configure the database variables in the project's
Production environment and redeploy after changing them.
Direct production MySQL connections require TLS and validate the server
certificate and hostname using [`mysql-ca.pem`](./mysql-ca.pem), or a CA
provided through `DB_SSL_CA`.

The production app reaches MySQL through an isolated authenticated WebSocket
TCP gateway on the Cloudflare Tunnel. The gateway runs in LXC 100, binds only
to loopback, and forwards to MySQL at `127.0.0.1:3306`; it does not expose
MySQL on the LXC network. Configure `DB_GATEWAY_URL` as
`wss://db-gateway.allinonesolution.uk/mysql` and set `DB_GATEWAY_TOKEN` as a
Vercel Production environment variable. The gateway forwards the MySQL protocol
without negotiating MySQL TLS; the WSS connection and Cloudflare Tunnel
protect the transport, and the gateway connects to MySQL over LXC loopback. When
`DB_GATEWAY_URL` is configured, the app does not load or use the MySQL CA file.
Do not use the gateway token in client-side code or expose it with a
`NEXT_PUBLIC_` name. Local development should use the same gateway URL and
token when the MySQL server is not directly reachable.

Apply the schema and migrations in this directory to the target database. The
application account `gauteng_health_assets_app` needs `SELECT`, `INSERT`,
`UPDATE`, and `DELETE` privileges on `health_assets`; `SELECT`, `INSERT`, and
`UPDATE` on `health_facilities`; `SELECT`, `INSERT`, and `UPDATE` on `app_users`;
`SELECT`, `INSERT`, and `DELETE` on `app_sessions`; and `SELECT`, `INSERT`, and
`UPDATE` on `health_asset_disposals`, `health_asset_loss_reports`,
`health_asset_decommission_requests`, and `health_asset_maintenance_records`;
`SELECT` and `INSERT` on `health_asset_evidence`,
`health_asset_workflow_evidence`, `health_asset_audit`, `health_asset_transfers`,
`health_asset_verifications`, and `health_asset_lifespan_extensions`; and
`SELECT`, `INSERT`,
`UPDATE`, and `DELETE` on `app_login_rate_limits`. Do not grant
application-level `DELETE` on disposal, loss, decommission, maintenance, or
evidence history, or on user tables.

The facility selector uses [`health_facilities.sql`](./health_facilities.sql)
and can be populated with `node scripts/import-gauteng-facilities.mjs`. The
importer pulls named hospitals, clinics, health centres, and health posts from
OpenStreetMap's Overpass API for Gauteng's five district/municipal areas, then
upserts them by their OSM object IDs. The source is community-mapped and may be
incomplete or out of date; verify facility names and regional assignments
against the Department's current register before relying on it as an official
master list. OpenStreetMap data is available under the ODbL; attribution is
provided in the application.

Sub-district assignment uses reviewed locality aliases in the importer and in
the facility and disposal APIs. The latest geography audit checked all 456
source rows, confirmed district and coordinate coverage, filled supported
missing assignments, and corrected reviewed conflicts. The directory currently
has 435 choices when grouped by district, normalized name, and sub-district.
The application retains its Tshwane municipal Region 1–7 classification.
Screenshots listing Tshwane health sub-districts 1–6 use a different
classification and should not be copied directly into the municipal Region
fields. Location checks place Gazankulu Clinic in Moshongo Section (Region 4)
and Sablemed Medical Practice on Kameelfontein Road (Region 5); their stored
assignments and locality inference were updated accordingly. New Boikhutsong
Clinic remains in Region 1. Facility-name aliases were added for the Tshwane municipality-region
assignments that can be established from the listed facility's location or
known town. Many names in the supplied municipal-wide list are not records in
the current OSM-based directory; adding names alone does not create directory
entries or asset-register choices. For other records with a confirmed ward or
municipality-level mapping but no named locality, the directory uses that
explicit ward or an available municipality “Other” bucket instead of
inventing a town. Later imports preserve an existing assignment when the
source cannot infer one, so reviewed corrections are not cleared.

The facility selector deduplicates repeated OSM source objects by district,
normalized facility name, and sub-district. This keeps same-named facilities
in different areas separately selectable and filters assets by the selected
facility's district and sub-district.
The app's facility directory and its asset/disposal selectors omit directory
or asset-only facility entries without both a district and a resolved
sub-district. These source records are retained in MySQL for correction and can
reappear in the app once their assignment is completed.

Sedibeng uses the active health directory's three operational groups:
Emfuleni Sub District, Lesedi Sub District, and Midvaal Sub District. Existing
OSM facilities are grouped using their recorded locality/address and matching
directory place names. The current source data has facilities in Emfuleni and
Lesedi, but none that can presently be matched to Midvaal; the Midvaal filter
is available for facilities added from a verified directory source. The
screenshots are partial lists and do not provide enough information to safely
create all missing facility records.

West Rand follows the active directory's four displayed areas:
Merafong City, Mogale City, Randfontein, and Westonaria Local Municipalities.
Existing facilities are grouped by their recorded localities and matching
directory names. The Arrie Nel Docville Pharmacy Clinic record has a Pretoria
address despite being tagged West Rand, so its municipality grouping remains
unassigned pending correction of its source record. The screenshots do not
provide enough information to safely create all the other missing facility
records.

Ekurhuleni follows the six health sub-districts shown in the active directory:
East 1, East 2, North 1, North 2, South 1, and South 2. Existing facilities
are grouped by their location and the screenshot's facility/locality names.
These screenshots guide the filter groupings; they are not used to create
facility records that are absent from the current OSM-based directory.
