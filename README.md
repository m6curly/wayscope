# WayScope — OpenStreetMap History Explorer

A browser-based viewer for OpenStreetMap node, way and relation histories, changeset downloads, historical geometry, place search, layer comparison, and GeoJSON/CSV export.

## Run it

1. Extract the ZIP to a folder.
2. Open `index.html` in a modern browser.
3. Keep an internet connection available. Leaflet, the OSM API, map tiles and place-name search are loaded from online services; there is no Node.js/npm build step.

Some browsers or local security policies may restrict network access when opening files directly. If that happens, open the folder with any simple local static-file server; the project itself does not require a build system.

## Load OSM objects

- Choose **Way**, **Node**, **Relation** or **Changeset** beside the numeric ID field and select **Load**.
- Way, Node and Relation IDs load the corresponding OSM API `/history` response.
- Changeset IDs load the changeset's downloaded OSM XML. A changeset is an edit batch, not a separately versioned OSM object. Its view therefore shows the objects included in that edit, rather than pretending there is a changeset version history.
- You can instead upload a standard OSM XML history containing all versions of one Node, Way or Relation. Changeset Download XML (`osmChange`) is also supported. Dragging an XML/OSM file onto the map works too.
- Historical geometry may need extra node and relation-member-way history requests. Very large histories/relations are bounded to help keep the browser responsive.

## Search

The top search field accepts `latitude, longitude` or a place name. Coordinates are resolved locally. Place names are searched only when the Search button is submitted, through the public Photon demo using OpenStreetMap-derived data; no autocomplete is performed. Public demo services can throttle requests or be unavailable, and do not provide guaranteed uptime.

## Basemaps

The selector includes public, no-API-key raster endpoints: OpenStreetMap Standard, HOT, OSM France, OSM Germany, CyclOSM, OpenTopoMap-R, Esri Satellite, Esri Street, Esri Topographic, Esri Gray Canvas, Esri Terrain, Esri Ocean, Esri National Geographic, OpenHikingMap and NASA Blue Marble.

“No API key” does **not** mean unlimited or suitable for every commercial/high-volume deployment. Each service has its own attribution, access, cache, traffic and commercial-use terms. Tile endpoints can change, throttle, or go offline; this app warns when the selected provider reports tile errors. Always follow the selected provider's published terms and keep the attribution displayed by the map. For production/high-volume use, arrange an appropriate tile provider or host tiles yourself.

Useful provider policies:

- OpenStreetMap Standard tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- Photon project and public service information: https://github.com/komoot/photon

## Layer interaction and exports

- Drag a version row to reorder layers within its year group; drag a year group to reorder groups. The insertion line shows where the item will land. There are no up/down arrow controls.
- Use the checkboxes to toggle visibility and select a version to inspect metadata, tags and point status.
- Export the selected version or all loaded versions as GeoJSON, or export the selected snapshot's point audit as CSV.

## Notes

- The OpenStreetMap API and all tile/search services require internet access and may impose rate limits.
- Node positions that cannot be retrieved for a historical timestamp are marked as missing/unavailable, so geometry may contain gaps.
- For a relation, the viewer resolves direct Node and Way members; nested Relation members are not recursively expanded into geometry.


## Geospatial analysis panel

The Analysis panel now reports closed-polygon footprint area for historical snapshots, annual latest-snapshot area, and net area change versus the preceding measurable year. Enable **Show historical polygon fills and area labels on map** to display the historical polygon overlays and hover labels. Area is calculated from complete closed rings with a spherical-earth formula. Open ways (for example, roads), nodes, incomplete geometry and unclosed boundaries cannot produce an enclosed area. Annual Δ is a net footprint-area difference, not a full geometric symmetric-difference measurement and not evidence of a legal/political border change.

## Connected linework area analysis

The Analysis panel also detects enclosed areas formed by multiple line segments in a historical snapshot. It joins segment endpoints at approximately 0.1 m coordinate precision and measures only closed, non-branching components. It does not bridge gaps, infer missing edges, or polygonize branched/intersecting networks. Detected polygons are listed individually, summed in square metres / km², and can be displayed on the map with area labels. Annual timeline values prefer detected connected-linework area, falling back to a directly closed geometry when no linework polygon is detected.

This is a conservative geometry-based measurement, not evidence of a legal or political boundary change. Results depend on the completeness and topology of the OSM history and on the availability of historical node coordinates.


## Geospatial intelligence dashboard (enhanced build)

The Analysis panel now includes a structured, expandable dashboard for the loaded object's history:
- Data-readiness and object/version inventory (counts are scoped to the loaded history).
- Available geometry measurements, including line length calculated from reconstructed coordinates.
- Version-to-version tag, node-sequence, relation-member, visibility, and timestamp comparisons.
- Year-grouped snapshots based only on versions present in the loaded history.
- Tag-key frequency and annual footprint summaries where closed geometry is actually detected.
- KML export, GeoJSON export, point-audit CSV, and a browser print report (choose **Save as PDF** in the print dialog).

### Interpretation and limitations
This remains a browser-only application. A single object history is not a regional inventory, so the dashboard does not claim regional totals, complete changeset statistics, or comprehensive contributor analytics. Historical geometry can be incomplete when dependent node/member versions are unavailable. Area is only shown for closed geometry detected by the existing geometry engine; open linework is measured by length instead. KML exports the reconstructed point/line geometry available to the app; it does not invent polygon topology. OSM mapped-data changes are not proof of legal or real-world boundary changes.

The app still uses the public OSM API and public map/geocoding services; their availability and usage limits apply.


## Annual snapshot comparison gallery

The Analysis rail opens a full-width comparison board with one compact geometry preview per available year. Snapshots use a shared geographic frame so relative shape and size changes can be compared consistently. Closed, measurable geometry is labeled with area; open ways are labeled with line length. Each tile links to the latest loaded version in its year. Preview backdrops are schematic and the geometry comes from the loaded OSM history; these previews are not independent basemap tiles.
