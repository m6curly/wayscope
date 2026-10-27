'use strict';

(() => {
  const $ = id => document.getElementById(id);

  const state = {
    versions: [],
    objectId: null,
    objectType: 'way',
    uniqueNodeCount: 0,
    memberWayHistories: new Map(),
    searchMarker: null,
    lastGeocodeAt: 0,
    lastTileErrorAt: 0,
    activeDrag: '',
    histories: new Map(),
    analyses: new Map(),
    layers: new Map(),
    selected: null,
    showPoints: true,
    showAreaOverlay: false,
    generation: 0,
    collapsedYears: new Set(),
    layerOrder: new Map(),
    yearOrder: [],
    basemap: 'osm',
    toastTimer: null,
    map: null,
    tileLayer: null
  };

  const API = 'https://api.openstreetmap.org/api/0.6';
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const MAX_UNIQUE_NODES = 12000;
  const MAX_VERSIONS = 2000;
  const CONCURRENCY = 4;

  function formatCoordinate(value, positive, negative) {
    return `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
  }

  function initMap() {
    if (!window.L) {
      toast('Map library could not load. Check your internet connection and reload.');
      return;
    }

    state.map = L.map('map', {
      zoomControl: false,
      preferCanvas: true,
      worldCopyJump: true
    }).setView([20.5937, 78.9629], 5);

    setBasemap('osm');

    state.map.on('mousemove', e => {
      $('coordinateReadout').textContent =
        `${formatCoordinate(e.latlng.lat, 'N', 'S')}  ${formatCoordinate(e.latlng.lng, 'E', 'W')}`;
    });
    state.map.on('contextmenu', e => {
      const lat = e.latlng.lat, lon = e.latlng.lng;
      const label = `${formatCoordinate(lat, 'N', 'S')}, ${formatCoordinate(lon, 'E', 'W')}`;
      const popup = L.popup({ closeButton: true, autoClose: true })
        .setLatLng(e.latlng)
        .setContent(`<button type="button" class="copy-coordinate">${label} · Click to copy</button>`)
        .openOn(state.map);
      setTimeout(() => {
        const button = document.querySelector('.copy-coordinate');
        if (button) button.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(label);
            toast(`Copied ${label}`);
            state.map.closePopup(popup);
          } catch (_) { toast('Copy unavailable. Select the coordinate and copy it.'); }
        });
      }, 0);
    });

    $('zoomInBtn').addEventListener('click', () => state.map.zoomIn());
    $('zoomOutBtn').addEventListener('click', () => state.map.zoomOut());
    $('fitBtn').addEventListener('click', fitVisible);
  }

  // Public no-key tile endpoints. Each provider has separate terms and fair-use limits.
  // CARTO was intentionally removed because its current unauthenticated service can show an API-key watermark.
  const BASEMAPS = {
    osm: {
      label: 'OpenStreetMap Standard',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }
    },
    hot: {
      label: 'Humanitarian (HOT)',
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      options: { subdomains: 'abc', maxZoom: 19, attribution: '&copy; OpenStreetMap contributors, Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>' }
    },
    osmfr: {
      label: 'OSM France',
      url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
      options: { subdomains: 'abc', maxZoom: 20, attribution: '&copy; OpenStreetMap contributors, style by <a href="https://openstreetmap.fr/">OSM France</a>' }
    },
    osmde: {
      label: 'OSM Germany',
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Tiles <a href="https://openstreetmap.de/">openstreetmap.de</a>' }
    },
    cycle: {
      label: 'CyclOSM',
      url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      options: { subdomains: 'abc', maxZoom: 20, attribution: '&copy; OpenStreetMap contributors · <a href="https://www.cyclosm.org/">CyclOSM</a>' }
    },
    topo: {
      label: 'OpenTopoMap-R',
      url: 'https://tile.openmaps.fr/opentopomap/{z}/{x}/{y}.png',
      options: { maxZoom: 17, attribution: '&copy; OpenStreetMap contributors · <a href="https://github.com/sletuffe/OpenTopoMap">OpenTopoMap-R</a> · <a href="https://openmaps.fr/donate">Tile server support</a>' }
    },
    imagery: {
      label: 'Esri Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    street: {
      label: 'Esri Street',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    worldtopo: {
      label: 'Esri Topographic',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    gray: {
      label: 'Esri Gray Canvas',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 16, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    terrain: {
      label: 'Esri Terrain',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 13, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    ocean: {
      label: 'Esri Ocean',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 13, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    natgeo: {
      label: 'Esri National Geographic',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 16, attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> and its data providers' }
    },
    hiking: {
      label: 'OpenHikingMap',
      url: 'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png',
      options: { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors · <a href="https://wiki.openstreetmap.org/wiki/OpenHikingMap">OpenHikingMap</a> · <a href="https://openmaps.fr/donate">Tile server support</a>' }
    },
    nasa: {
      label: 'NASA Blue Marble',
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
      options: { maxZoom: 8, attribution: 'Imagery courtesy of <a href="https://www.earthdata.nasa.gov/data/instruments/gibs">NASA GIBS</a>' }
    }
  };

  function setBasemap(name) {
    if (!state.map || !BASEMAPS[name]) return;
    if (state.tileLayer) state.map.removeLayer(state.tileLayer);
    const config = BASEMAPS[name];
    const nextLayer = L.tileLayer(config.url, {
      ...config.options,
      crossOrigin: true,
      updateWhenIdle: true,
      keepBuffer: 2
    });
    nextLayer.on('tileerror', () => {
      const now = Date.now();
      if (now - state.lastTileErrorAt > 5000) {
        state.lastTileErrorAt = now;
        toast(`${config.label} tiles are not responding. Try another basemap; public tile services can be rate-limited or unavailable.`);
      }
    });
    nextLayer.addTo(state.map);
    state.tileLayer = nextLayer;
    state.basemap = name;
    document.querySelectorAll('[data-basemap]').forEach(button => {
      button.classList.toggle('active', button.dataset.basemap === name);
      button.setAttribute('aria-pressed', String(button.dataset.basemap === name));
    });
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 3600);
  }

  function setLoading(on, title = 'Preparing history…', detail = 'Please keep this tab open.', percent = 0) {
    $('loadingOverlay').hidden = !on;
    $('loadingTitle').textContent = title;
    $('loadingDetail').textContent = detail;
    $('progressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;

    $('exportBtn').disabled = on || !state.versions.length;
    $('headerUploadBtn').disabled = on;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function formatDate(value) {
    if (!value) return 'Date not recorded';

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? 'Date not recorded'
      : new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
          timeZoneName: 'short'
        }).format(date);
  }

  function yearOf(version) {
    const d = new Date(version.timestamp);

    return Number.isNaN(d.getTime())
      ? 'Unknown year'
      : String(d.getUTCFullYear());
  }

  function colorFor(index) {
    // Golden-angle hue spacing gives each version its own high-contrast colour.
    const hue = (index * 137.508) % 360;
    return `hsl(${hue.toFixed(2)} 92% 52%)`;
  }

  function parseTags(element) {
    return [...element.children]
      .filter(child => child.localName === 'tag')
      .map(tag => ({ k: tag.getAttribute('k') || '', v: tag.getAttribute('v') || '' }));
  }

  function objectRecord(element, type, fallbackVersion) {
    const id = element.getAttribute('id') || '';
    const sourceVersion = Number(element.getAttribute('version') || fallbackVersion || 1);
    const nodeIds = type === 'way'
      ? [...element.children].filter(child => child.localName === 'nd').map(nd => nd.getAttribute('ref')).filter(Boolean)
      : type === 'node' ? [id] : [];
    const members = type === 'relation'
      ? [...element.children].filter(child => child.localName === 'member').map(member => ({
          type: member.getAttribute('type') || '',
          ref: member.getAttribute('ref') || '',
          role: member.getAttribute('role') || ''
        })).filter(member => member.ref && ['node', 'way', 'relation'].includes(member.type))
      : [];

    return {
      id,
      version: sourceVersion,
      sourceVersion,
      type,
      timestamp: element.getAttribute('timestamp') || '',
      user: element.getAttribute('user') || '',
      changeset: element.getAttribute('changeset') || '',
      visible: element.getAttribute('visible') !== 'false',
      nodeIds,
      members,
      tags: parseTags(element),
      lat: type === 'node' && element.hasAttribute('lat') ? Number(element.getAttribute('lat')) : null,
      lon: type === 'node' && element.hasAttribute('lon') ? Number(element.getAttribute('lon')) : null
    };
  }

  function parseObjectXml(xmlText, filename = 'history.xml') {
    if (!xmlText.trim()) throw new Error('The selected file is empty. Choose an OSM XML file.');
    if (/<!DOCTYPE/i.test(xmlText)) throw new Error('DOCTYPE declarations are not accepted for safety. Download a standard OSM XML file and try again.');

    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML. Please check the download and try again.');
    const root = doc.documentElement;
    if (!root || !['osm', 'osmChange'].includes(root.localName)) {
      throw new Error('This does not look like standard OpenStreetMap XML. Expected an <osm> history or <osmChange> file.');
    }

    const safeIntegerId = id => /^\d+$/.test(String(id || ''));
    const isChangeFile = root.localName === 'osmChange';
    let records = [];

    if (isChangeFile) {
      const wrappers = [...root.children].filter(el => ['create', 'modify', 'delete'].includes(el.localName));
      wrappers.forEach(wrapper => {
        [...wrapper.children].filter(el => ['node', 'way', 'relation'].includes(el.localName)).forEach(el => {
          const record = objectRecord(el, el.localName, records.length + 1);
          record.visible = wrapper.localName !== 'delete' && record.visible;
          records.push(record);
        });
      });
      if (!records.length) throw new Error('This changeset XML does not contain any created, modified or deleted OSM objects.');
      if (records.length > MAX_VERSIONS) throw new Error(`This changeset contains more than ${MAX_VERSIONS.toLocaleString()} changed objects, above the current browser-safe limit.`);

      records = records.map((record, index) => ({
        ...record,
        version: index + 1,
        sourceVersion: record.sourceVersion || null,
        changeset: record.changeset || '',
        syntheticVersion: true
      }));

      const fileMatch = String(filename).match(/changeset[-_ ]?(\d+)/i);
      const firstChangeset = records.find(r => r.changeset)?.changeset;
      const id = fileMatch?.[1] || firstChangeset || 'download';
      return { type: 'changeset', id, versions: records, source: doc };
    }

    records = [...root.children]
      .filter(el => ['node', 'way', 'relation'].includes(el.localName))
      .map((el, index) => objectRecord(el, el.localName, index + 1));

    if (!records.length) {
      throw new Error('No node, way or relation records were found in this OSM XML.');
    }

    const types = [...new Set(records.map(record => record.type))];
    const ids = [...new Set(records.map(record => record.id))];
    if (types.length !== 1 || ids.length !== 1) {
      throw new Error('Upload one object history at a time (all versions of one Node, Way or Relation), or upload a Changeset Download XML.');
    }
    if (!safeIntegerId(records[0].id)) throw new Error('The OSM object ID in this file is not a valid numeric ID.');

    const type = types[0];
    const id = records[0].id;
    if (records.some(record => !Number.isSafeInteger(record.version) || record.version < 1)) {
      throw new Error(`The ${type} history contains an invalid version number.`);
    }
    if (type === 'way' && records.some(record => !record.nodeIds.length && record.visible)) {
      throw new Error(`Way ${id} contains a visible version with no node references.`);
    }
    if (records.some(record => record.type === 'way' && record.nodeIds.some(nodeId => !safeIntegerId(nodeId)))) {
      throw new Error(`Way ${id} contains an invalid node reference.`);
    }
    if (records.length > MAX_VERSIONS) throw new Error(`This file contains more than ${MAX_VERSIONS.toLocaleString()} versions, above the current browser-safe limit.`);

    records.sort((a, b) => a.version - b.version);
    const seen = new Set();
    for (const record of records) {
      if (seen.has(record.version)) throw new Error(`Duplicate version ${record.version} was found. Please download the object history again.`);
      seen.add(record.version);
    }
    return { type, id, versions: records, source: doc };
  }

  function entityLabel(type, id) {
    const names = { node: 'Node', way: 'Way', relation: 'Relation', changeset: 'Changeset' };
    return `${names[type] || 'OSM object'} ${id}`;
  }

  function historyLabel(version) {
    if (state.objectType === 'changeset') {
      return `${entityLabel(version.type || 'way', version.id)}${version.sourceVersion ? ` · v${version.sourceVersion}` : ''}`;
    }
    return `Version ${version.version}`;
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast('File is larger than 30 MB.'); return; }
    if (!/\.(xml|osm)$/i.test(file.name) && file.type && !/xml/i.test(file.type)) { toast('Please choose an XML or OSM file.'); return; }

    const generation = ++state.generation;
    setLoading(true, 'Reading OSM XML…', file.name, 3);
    try {
      const xmlText = await file.text();
      if (generation !== state.generation) return;
      const parsed = parseObjectXml(xmlText, file.name);
      if (state.searchMarker && state.map) state.map.removeLayer(state.searchMarker);
      state.searchMarker = null;
      const versions = parsed.versions;
      const uniqueNodes = new Set();
      versions.forEach(version => {
        (version.nodeIds || []).forEach(id => uniqueNodes.add(id));
        (version.members || []).filter(member => member.type === 'node').forEach(member => uniqueNodes.add(member.ref));
      });
      if (uniqueNodes.size > MAX_UNIQUE_NODES) throw new Error(`This history refers to more than ${MAX_UNIQUE_NODES.toLocaleString()} unique points. The current limit keeps the browser responsive.`);

      state.versions = versions;
      state.objectType = parsed.type;
      state.objectId = parsed.id;
      state.uniqueNodeCount = uniqueNodes.size;
      state.histories.clear();
      state.memberWayHistories.clear();
      state.analyses.clear();
      state.layers.clear();
      state.collapsedYears.clear();
      state.layerOrder.clear();
      state.yearOrder = [...new Set(versions.map(yearOf))].sort((a, b) =>
        a === 'Unknown year' ? 1 : b === 'Unknown year' ? -1 : Number(b) - Number(a)
      );
      state.yearOrder.forEach(year => {
        state.layerOrder.set(year, versions.filter(v => yearOf(v) === year).map(v => v.version).reverse());
      });

      // Node history XML already contains the point's historical coordinates.
      if (parsed.type === 'node') {
        state.histories.set(parsed.id, versions.map(v => ({
          id: v.id, version: v.version, lat: v.lat, lon: v.lon,
          timestamp: v.timestamp, visible: v.visible, user: v.user
        })));
      }
      // A changeset download contains changed node positions as well as ways/relations.
      if (parsed.type === 'changeset') {
        const groupedNodes = new Map();
        versions.filter(v => v.type === 'node').forEach(v => {
          if (!groupedNodes.has(v.id)) groupedNodes.set(v.id, []);
          groupedNodes.get(v.id).push({ id: v.id, version: v.sourceVersion || v.version, lat: v.lat, lon: v.lon, timestamp: v.timestamp, visible: v.visible, user: v.user });
        });
        groupedNodes.forEach((history, id) => state.histories.set(id, history));
      }

      state.selected = versions[versions.length - 1];
      $('exportBtn').disabled = false;
      $('layersEmpty').hidden = true;
      $('layerControls').hidden = false;
      $('analysisEmpty').hidden = true;
      $('analysisContent').hidden = false;
      showPanel('layers');
      renderLayers();
      renderAnalysis();
      await loadAllGeometry(generation);
      if (generation !== state.generation) return;
      selectVersion(state.selected.version, true);
      toast(`Loaded ${versions.length} ${parsed.type === 'changeset' ? 'changeset objects' : 'history records'} successfully.`);
    } catch (error) {
      if (generation !== state.generation) return;
      toast(error.message || 'Could not read this OSM XML.');
    } finally {
      if (generation === state.generation) setLoading(false);
    }
  }

  async function fetchNodeHistory(nodeId, generation) {
    if (state.histories.has(nodeId)) {
      return state.histories.get(nodeId);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      let response;
      let body;

      try {
        response = await fetch(
          `${API}/node/${encodeURIComponent(nodeId)}/history`,
          {
            headers: { Accept: 'application/xml' },
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        body = await response.text();
      } finally {
        clearTimeout(timeout);
      }

      if (generation !== state.generation) return [];

      const doc = new DOMParser().parseFromString(body, 'application/xml');

      if (doc.querySelector('parsererror')) {
        throw new Error('Invalid node history XML');
      }

      const history = [...doc.getElementsByTagName('node')].map(node => {
        const lat = Number(node.getAttribute('lat'));
        const lon = Number(node.getAttribute('lon'));

        return {
          id: node.getAttribute('id') || nodeId,
          version: Number(node.getAttribute('version') || 0),
          lat,
          lon,
          timestamp: node.getAttribute('timestamp') || '',
          visible: node.getAttribute('visible') !== 'false',
          user: node.getAttribute('user') || ''
        };
      });

      state.histories.set(nodeId, history);
      return history;
    } catch (error) {
      if (generation === state.generation) {
        state.histories.set(nodeId, {
          failed: true,
          message: error.message
        });
      }

      return {
        failed: true,
        message: error.message
      };
    }
  }

  async function fetchMemberWayHistory(wayId, generation) {
    if (state.memberWayHistories.has(wayId)) return state.memberWayHistories.get(wayId);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      let response;
      try {
        response = await fetch(`${API}/way/${encodeURIComponent(wayId)}/history`, {
          headers: { Accept: 'application/xml' }, signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        if (generation !== state.generation) return [];
        const doc = new DOMParser().parseFromString(body, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Invalid way history XML');
        const ways = [...doc.documentElement.children]
          .filter(el => el.localName === 'way')
          .map((el, index) => objectRecord(el, 'way', index + 1))
          .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.version - b.version);
        state.memberWayHistories.set(wayId, ways);
        return ways;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (generation === state.generation) state.memberWayHistories.set(wayId, { failed: true, message: error.message });
      return { failed: true, message: error.message };
    }
  }

  function historicalPosition(history, timestamp) {
    if (!Array.isArray(history)) return null;

    const target = Date.parse(timestamp);

    if (!Number.isFinite(target)) return null;

    let best = null;
    let bestTime = -Infinity;

    for (const item of history) {
      const time = Date.parse(item.timestamp);

      if (
        item.visible &&
        Number.isFinite(item.lat) &&
        Number.isFinite(item.lon) &&
        Math.abs(item.lat) <= 90 &&
        Math.abs(item.lon) <= 180 &&
        Number.isFinite(time) &&
        time <= target &&
        time > bestTime
      ) {
        best = item;
        bestTime = time;
      }
    }

    return best;
  }

  async function loadAllGeometry(generation) {
    // Relation snapshots refer to member ways. Fetch their version histories first,
    // then resolve each member's node coordinates at the relation's timestamp.
    const memberWayIds = [...new Set(state.versions.flatMap(v =>
      (v.members || []).filter(member => member.type === 'way').map(member => member.ref)
    ))];
    let wayCursor = 0;
    const wayWorkers = Array.from({ length: Math.min(CONCURRENCY, memberWayIds.length) }, async () => {
      while (wayCursor < memberWayIds.length && generation === state.generation) {
        const id = memberWayIds[wayCursor++];
        await fetchMemberWayHistory(id, generation);
      }
    });
    await Promise.all(wayWorkers);
    if (generation !== state.generation) return;

    const nodeIds = new Set();
    state.versions.forEach(v => {
      (v.nodeIds || []).forEach(id => nodeIds.add(id));
      (v.members || []).filter(member => member.type === 'node').forEach(member => nodeIds.add(member.ref));
    });
    state.memberWayHistories.forEach(history => {
      if (Array.isArray(history)) history.forEach(way => (way.nodeIds || []).forEach(id => nodeIds.add(id)));
    });
    const ids = [...nodeIds];
    if (ids.length > MAX_UNIQUE_NODES) {
      throw new Error(`This object references ${ids.length.toLocaleString()} unique points across its member histories, above the current limit of ${MAX_UNIQUE_NODES.toLocaleString()}. Try a smaller relation or a way history.`);
    }

    let cursor = 0;
    let completed = 0;
    let failed = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (cursor < ids.length && generation === state.generation) {
        const id = ids[cursor++];
        const history = await fetchNodeHistory(id, generation);
        if (history && history.failed) failed++;
        completed++;
        if (completed % 5 === 0 || completed === ids.length) {
          const pct = ids.length ? Math.round(completed / ids.length * 100) : 100;
          setLoading(true, 'Finding historical point positions…', `${completed.toLocaleString()} of ${ids.length.toLocaleString()} points checked · ${failed} unavailable`, pct);
        }
      }
    });
    await Promise.all(workers);
    if (generation !== state.generation) return;

    state.uniqueNodeCount = ids.length;
    state.analyses.clear();
    for (const version of state.versions) state.analyses.set(version.version, buildAnalysis(version));
    renderLayers();
    renderAnalysis();
    if (failed) toast(`${failed} point histories could not be reached. Some geometries may have gaps.`);
    const failedWays = [...state.memberWayHistories.values()].filter(item => item?.failed).length;
    if (failedWays) toast(`${failedWays} relation member way histories could not be reached. Some relation geometry may be incomplete.`);
  }

  function resolvePoint(id, timestamp, order) {
    const history = state.histories.get(id);
    const exact = historicalPosition(history, timestamp);
    const latest = Array.isArray(history)
      ? history.filter(n => n.visible && Number.isFinite(n.lat) && Number.isFinite(n.lon) && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180)
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0]
      : null;
    return {
      id, order,
      lat: exact?.lat ?? null,
      lon: exact?.lon ?? null,
      status: exact ? 'exact' : history?.failed ? 'unavailable' : latest ? 'newer-only' : 'deleted-or-missing',
      latest: latest ? { lat: latest.lat, lon: latest.lon, timestamp: latest.timestamp } : null
    };
  }

  // Spherical ring area (m²); only complete closed rings are measurable.
  function ringAreaM2(coords) {
    if (!Array.isArray(coords) || coords.length < 4) return null;
    const first = coords[0], last = coords[coords.length - 1];
    if (Math.abs(first[0]-last[0]) > 1e-7 || Math.abs(first[1]-last[1]) > 1e-7) return null;
    const r = 6371008.8; let sum = 0;
    for (let i=0; i<coords.length-1; i++) {
      const [lat1,lon1]=coords[i], [lat2,lon2]=coords[i+1];
      sum += (lon2-lon1)*Math.PI/180*(2+Math.sin(lat1*Math.PI/180)+Math.sin(lat2*Math.PI/180));
    }
    return Math.abs(sum*r*r/2);
  }
  function formatArea(m2) {
    if (!Number.isFinite(m2)) return 'Not measurable';
    return m2 >= 1000000 ? `${(m2/1000000).toLocaleString(undefined,{maximumFractionDigits:3})} km²` : `${Math.round(m2).toLocaleString()} m²`;
  }

  // Conservative linework polygonizer: joins segment endpoints and accepts only
  // closed, degree-2 components. It never snaps gaps or guesses missing edges.
  function detectClosedLinework(segments) {
    const nodes = new Map(), edges = new Map();
    const keyOf = c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
    for (const segment of segments || []) {
      for (let i = 1; i < segment.length; i++) {
        const a = segment[i-1], b = segment[i];
        if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) continue;
        const ka=keyOf(a), kb=keyOf(b);
        if (ka===kb) continue;
        if (!nodes.has(ka)) nodes.set(ka,{coord:a,edges:[]});
        if (!nodes.has(kb)) nodes.set(kb,{coord:b,edges:[]});
        const ek=[ka,kb].sort().join('|');
        if (edges.has(ek)) continue;
        edges.set(ek,{a:ka,b:kb});
        nodes.get(ka).edges.push(ek); nodes.get(kb).edges.push(ek);
      }
    }
    const visitedNodes=new Set(), rings=[];
    for (const start of nodes.keys()) {
      if (visitedNodes.has(start)) continue;
      const stack=[start], component=[]; visitedNodes.add(start);
      while(stack.length) {
        const k=stack.pop(); component.push(k);
        for(const ek of nodes.get(k).edges){const e=edges.get(ek), other=e.a===k?e.b:e.a;if(!visitedNodes.has(other)){visitedNodes.add(other);stack.push(other);}}
      }
      // Branching networks are intentionally not guessed into polygons.
      if(component.length<3 || component.some(k=>nodes.get(k).edges.length!==2)) continue;
      const first=component[0], ring=[nodes.get(first).coord]; let current=first, previousEdge=null, guard=0;
      do {
        const nextEdge=nodes.get(current).edges.find(e=>e!==previousEdge);
        if(!nextEdge) break;
        const edge=edges.get(nextEdge), next=edge.a===current?edge.b:edge.a;
        ring.push(nodes.get(next).coord); previousEdge=nextEdge; current=next;
        guard++;
      } while(current!==first && guard<=component.length+1);
      if(current===first && ring.length>=4) {
        const area=ringAreaM2(ring);
        if(Number.isFinite(area) && area>1) rings.push({coordinates:ring,areaM2:area});
      }
    }
    return rings;
  }

  function buildAnalysis(version) {
    // Relation members are ordered paths, not one flat node list. Keep each member way as its own segment.
    if ((version.type === 'relation' || (state.objectType === 'relation' && version.members?.length)) && version.members?.length) {
      const points = [];
      const segments = [];
      let order = 1;
      const timestampMs = Date.parse(version.timestamp);

      for (const member of version.members) {
        if (member.type === 'node') {
          points.push(resolvePoint(member.ref, version.timestamp, order++));
          continue;
        }
        if (member.type !== 'way') continue;
        const history = state.memberWayHistories.get(member.ref);
        if (!Array.isArray(history)) continue;
        const candidates = history.filter(way => way.visible && Number.isFinite(Date.parse(way.timestamp)) && Date.parse(way.timestamp) <= timestampMs);
        candidates.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.version - a.version);
        const chosenWay = candidates[0];
        if (!chosenWay) continue;

        let segment = [];
        for (const id of chosenWay.nodeIds) {
          const point = resolvePoint(id, version.timestamp, order++);
          points.push(point);
          if (point.lat === null || point.lon === null) {
            if (segment.length > 1) segments.push(segment);
            segment = [];
          } else {
            segment.push([point.lat, point.lon]);
          }
        }
        if (segment.length > 1) segments.push(segment);
      }
      const coordinates = points.filter(p => p.lat !== null && p.lon !== null);
      const ringAreas = segments.map(ringAreaM2).filter(Number.isFinite);
      const areaM2 = ringAreas.length ? ringAreas.reduce((sum,n)=>sum+n,0) : null;
      const detectedPolygons = detectClosedLinework(segments);
      const networkAreaM2 = detectedPolygons.reduce((sum, polygon) => sum + polygon.areaM2, 0);
      return { version, points, coordinates, segments, areaM2, detectedPolygons, networkAreaM2, isPolygon: ringAreas.length>0, missing: points.length-coordinates.length, exact: coordinates.length, failed: points.filter(p=>p.status==='unavailable').length };
    }

    const points = (version.nodeIds || []).map((id, index) => resolvePoint(id, version.timestamp, index + 1));
    const coordinates = points.filter(p => p.lat !== null && p.lon !== null);
    const line = [];
    let segment = [];
    for (const point of points) {
      if (point.lat === null || point.lon === null) {
        if (segment.length > 1) line.push(segment);
        segment = [];
      } else {
        segment.push([point.lat, point.lon]);
      }
    }
    if (segment.length > 1) line.push(segment);
    const ringAreas = line.map(ringAreaM2).filter(Number.isFinite);
    const areaM2 = ringAreas.length ? ringAreas.reduce((sum,n)=>sum+n,0) : null;
    const detectedPolygons = detectClosedLinework(line);
    const networkAreaM2 = detectedPolygons.reduce((sum, polygon) => sum + polygon.areaM2, 0);
    return { version, points, coordinates, segments: line, areaM2, detectedPolygons, networkAreaM2, isPolygon: ringAreas.length>0, missing: points.length-coordinates.length, exact: coordinates.length, failed: points.filter(p=>p.status==='unavailable').length };
  }

  function clearDropIndicators(except = null) {
    document.querySelectorAll('.drop-target-before, .drop-target-after').forEach(el => {
      if (el !== except) el.classList.remove('drop-target-before', 'drop-target-after');
    });
  }

  function renderLayers() {
    const host = $('yearGroups');
    host.replaceChildren();

    const groups = new Map();

    state.versions.forEach(v => {
      const year = yearOf(v);

      if (!groups.has(year)) {
        groups.set(year, []);
      }

      groups.get(year).push({
        ...v,
        color: colorFor(state.yearOrder.indexOf(year))
      });
    });

    $('layerCount').textContent = `${state.versions.length}`;

    const sortedYears = [...groups.keys()].sort((a, b) =>
      state.yearOrder.indexOf(a) - state.yearOrder.indexOf(b)
    );

    sortedYears.forEach(year => {
      const order = state.layerOrder.get(year) || [];
      const items = groups.get(year).slice().sort((a, b) => order.indexOf(a.version) - order.indexOf(b.version));

      const section = document.createElement('section');
      section.className = 'year-group';
      section.dataset.year = year;
      section.draggable = true;
      section.addEventListener('dragstart', e => {
        if (e.target.closest('.version-row')) return;
        state.activeDrag = `group:${year}`;
        e.dataTransfer.setData('text/plain', state.activeDrag);
        e.dataTransfer.effectAllowed = 'move';
        section.classList.add('dragging');
      });
      section.addEventListener('dragend', () => {
        section.classList.remove('dragging', 'drop-target-before', 'drop-target-after');
        state.activeDrag = '';
        clearDropIndicators();
      });
      section.addEventListener('dragover', e => {
        const payload = state.activeDrag || e.dataTransfer.getData('text/plain') || '';
        if (!payload.startsWith('group:')) return;
        e.preventDefault();
        clearDropIndicators(section);
        section.classList.toggle('drop-target-before', e.clientY < section.getBoundingClientRect().top + section.getBoundingClientRect().height / 2);
        section.classList.toggle('drop-target-after', e.clientY >= section.getBoundingClientRect().top + section.getBoundingClientRect().height / 2);
      });
      section.addEventListener('dragleave', e => {
        if (!section.contains(e.relatedTarget)) section.classList.remove('drop-target-before', 'drop-target-after');
      });
      section.addEventListener('drop', e => {
        e.preventDefault();
        const payload = state.activeDrag || e.dataTransfer.getData('text/plain');
        const before = e.clientY < section.getBoundingClientRect().top + section.getBoundingClientRect().height / 2;
        clearDropIndicators();
        if (!payload.startsWith('group:')) return;
        const from = payload.slice(6), to = year;
        if (from === to) return;
        const fromIndex = state.yearOrder.indexOf(from);
        if (fromIndex < 0 || !state.yearOrder.includes(to)) return;
        state.yearOrder.splice(fromIndex, 1);
        const targetIndex = state.yearOrder.indexOf(to);
        state.yearOrder.splice(targetIndex + (before ? 0 : 1), 0, from);
        renderLayers();
      });

      const head = document.createElement('div');
      head.className = 'year-heading';

      const allOn = items.every(v => state.layers.get(v.version) !== false);

      head.innerHTML = `
        <button type="button" class="year-toggle"
          aria-label="Collapse ${escapeHTML(year)}"
          aria-expanded="true">
          <span class="chevron">▶</span>
        </button>
        <input class="year-master" type="checkbox"
          aria-label="Toggle all versions in ${escapeHTML(year)}"
          ${allOn ? 'checked' : ''}>
        <strong>${escapeHTML(year)}</strong>
        <small>${items.length} ${items.length === 1 ? 'version' : 'versions'}</small>
      `;

      const master = head.querySelector('input');
      const collapsed = state.collapsedYears.has(year);
      const toggle = head.querySelector('.year-toggle');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${year}`);

      master.addEventListener('change', () => {
        items.forEach(v => {
          setLayerVisible(v.version, master.checked, false);
        });

        renderLayers();
        fitVisible();
      });

      const list = document.createElement('div');
      list.className = 'version-list';

      items.forEach(v => {
        const row = document.createElement('div');
        row.className = `version-row${state.selected?.version === v.version ? ' selected-layer-row' : ''}`;
        row.draggable = true;
        row.dataset.version = String(v.version);
        row.addEventListener('dragstart', e => {
          e.stopPropagation();
          state.activeDrag = `version:${v.version}`;
          e.dataTransfer.setData('text/plain', state.activeDrag);
          e.dataTransfer.effectAllowed = 'move';
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => { row.classList.remove('dragging'); state.activeDrag = ''; clearDropIndicators(); });
        row.addEventListener('dragover', e => {
          const payload = state.activeDrag || e.dataTransfer.getData('text/plain') || '';
          if (!payload.startsWith('version:')) return;
          e.preventDefault(); e.stopPropagation();
          clearDropIndicators(row);
          const before = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
          row.classList.toggle('drop-target-before', before);
          row.classList.toggle('drop-target-after', !before);
        });
        row.addEventListener('dragleave', e => {
          if (!row.contains(e.relatedTarget)) row.classList.remove('drop-target-before', 'drop-target-after');
        });
        row.addEventListener('drop', e => {
          e.preventDefault(); e.stopPropagation();
          const payload = state.activeDrag || e.dataTransfer.getData('text/plain');
          const before = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
          clearDropIndicators();
          if (!payload.startsWith('version:')) return;
          const fromVersion = Number(payload.slice(8));
          const fromRecord = state.versions.find(x => x.version === fromVersion);
          if (!fromRecord || yearOf(fromRecord) !== year) return;
          const order = (state.layerOrder.get(year) || items.map(x => x.version)).slice();
          const from = order.indexOf(fromVersion);
          const target = order.indexOf(v.version);
          if (from < 0 || target < 0 || from === target) return;
          order.splice(from, 1);
          const insertAt = order.indexOf(v.version) + (before ? 0 : 1);
          order.splice(insertAt, 0, fromVersion);
          state.layerOrder.set(year, order);
          renderLayers();
        });

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = state.layers.get(v.version) !== false;
        check.setAttribute('aria-label', `Show version ${v.version}`);

        check.addEventListener('change', () => {
          setLayerVisible(v.version, check.checked);
        });

        const swatch = document.createElement('i');
        swatch.className = 'version-color';
        swatch.style.background = v.color;
        swatch.style.color = v.color;

        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'version-select';
        select.textContent = `${historyLabel(v)}${v.user ? ` · ${v.user}` : ''}`;
        select.title = `Inspect ${historyLabel(v)}`;

        select.addEventListener('click', () => {
          selectVersion(v.version);
        });

        const date = document.createElement('span');
        date.className = 'version-date';
        date.textContent = shortDate(v.timestamp);

        row.append(check, swatch, select, date);
        list.append(row);
      });

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';

        toggle.setAttribute('aria-expanded', String(!open));
        toggle.setAttribute('aria-label', `${open ? 'Expand' : 'Collapse'} ${year}`);

        list.hidden = open;
        if (open) state.collapsedYears.add(year);
        else state.collapsedYears.delete(year);
      });

      list.hidden = collapsed;
      section.append(head, list);
      host.append(section);
    });

    filterYears();
  }

  function shortDate(value) {
    const d = new Date(value);

    return Number.isNaN(d.getTime())
      ? '—'
      : new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: '2-digit',
          timeZone: 'UTC'
        }).format(d);
  }

  function setLayerVisible(version, visible, shouldFit = true) {
    state.layers.set(version, visible);

    const layer = state.layers.get(`leaflet:${version}`);

    if (layer && state.map) {
      if (visible && !state.map.hasLayer(layer)) {
        layer.addTo(state.map);
      }

      if (!visible && state.map.hasLayer(layer)) {
        state.map.removeLayer(layer);
      }
    }

    if (shouldFit) {
      fitVisible();
    }
  }

  function filterYears() {
    const q = $('yearSearch').value.trim().toLowerCase();

    document.querySelectorAll('.year-group').forEach(group => {
      const match =
        group.dataset.year.toLowerCase().includes(q) ||
        [...group.querySelectorAll('.version-select')]
          .some(b => b.textContent.toLowerCase().includes(q));

      group.hidden = !match;
    });
  }

  function drawLayers() {
    if (!state.map) return;

    for (const v of state.versions) {
      const analysis = state.analyses.get(v.version);

      if (!analysis) continue;

      const color = colorFor(state.yearOrder.indexOf(yearOf(v)));
      const selected = state.selected?.version === v.version;

      const group = L.layerGroup();

      analysis.segments.forEach(coords => {
        const closed = coords.length >= 4 && Math.abs(coords[0][0]-coords[coords.length-1][0])<1e-7 && Math.abs(coords[0][1]-coords[coords.length-1][1])<1e-7;
        if (closed && state.showAreaOverlay) {
          const polygon = L.polygon(coords, {color,weight:selected?3:1.5,opacity:.95,fillColor:color,fillOpacity:selected?.24:.10}).addTo(group);
          polygon.bindTooltip(`${yearOf(v)} · ${historyLabel(v)}<br><b>${formatArea(analysis.areaM2)}</b>`, {sticky:true});
          polygon.on('click',()=>selectVersion(v.version));
        }
        L.polyline(coords, {
          color: '#07111d',
          weight: selected ? 10 : 8,
          opacity: selected ? .92 : .68,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false
        }).addTo(group);

        const line = L.polyline(coords, {
          color,
          weight: selected ? 6 : 4,
          opacity: selected ? 1 : .88,
          lineCap: 'round',
          lineJoin: 'round',
          className: 'history-line'
        }).addTo(group);

        line.bindTooltip(`${entityLabel(v.type || state.objectType, v.id)} · ${historyLabel(v)}`, {
          sticky: true,
          direction: 'top'
        });

        line.on('click', () => selectVersion(v.version));
      });

      if (state.showAreaOverlay && analysis.detectedPolygons?.length) {
        analysis.detectedPolygons.forEach((item, index) => {
          const polygon = L.polygon(item.coordinates, {color, weight:selected?2.5:1.2, opacity:.95, fillColor:color, fillOpacity:selected?.22:.09}).addTo(group);
          polygon.bindTooltip(`${yearOf(v)} · Closed area ${index+1}<br><b>${formatArea(item.areaM2)}</b>`, {sticky:true});
          polygon.on('click',()=>selectVersion(v.version));
          const center = item.coordinates.reduce((acc,c)=>[acc[0]+c[0]/item.coordinates.length,acc[1]+c[1]/item.coordinates.length],[0,0]);
          L.marker(center,{interactive:false,keyboard:false,icon:L.divIcon({className:'area-map-label',html:`<span>${formatArea(item.areaM2)}</span>`,iconSize:null})}).addTo(group);
        });
      }

      // Only the selected version shows point markers.
      // This avoids thousands of overlapping markers when many versions are visible.
      if (state.showPoints && (selected || v.type === 'node')) {
        analysis.coordinates.forEach(p => {
          const marker = L.circleMarker([p.lat, p.lon], {
            radius: selected ? 5 : 3,
            color: '#07111d',
            weight: 1.2,
            fillColor: color,
            fillOpacity: .98,
            opacity: .95
          }).addTo(group);

          marker.bindPopup(
            `<b>${escapeHTML(historyLabel(v))}</b><br>Point ${p.order} · ID ${escapeHTML(p.id)}`
          );

          marker.on('click', () => selectVersion(v.version));
        });
      }

      state.layers.set(`leaflet:${v.version}`, group);

      if (state.layers.get(v.version) !== false) {
        group.addTo(state.map);
      }
    }
  }

  function redrawMap() {
    if (!state.map) return;

    state.map.eachLayer(layer => {
      if (layer !== state.tileLayer) {
        state.map.removeLayer(layer);
      }
    });

    for (const [key] of [...state.layers]) {
      if (String(key).startsWith('leaflet:')) {
        state.layers.delete(key);
      }
    }

    drawLayers();
    if (state.searchMarker) state.searchMarker.addTo(state.map);
    else fitVisible();
  }

  function fitVisible() {
    if (!state.map) return;

    const points = [];

    state.versions.forEach(v => {
      if (state.layers.get(v.version) === false) return;

      const a = state.analyses.get(v.version);

      if (a) {
        a.coordinates.forEach(p => points.push([p.lat, p.lon]));
      }
    });

    if (points.length) {
      const bounds = L.latLngBounds(points);

      if (bounds.isValid()) {
        state.map.fitBounds(bounds.pad(.12), { maxZoom: 17 });
      }
    }
  }

  function selectVersion(version, redraw = true) {
    const selected = state.versions.find(v => v.version === Number(version));

    if (!selected) return;

    state.selected = selected;

    $('rightTitle').textContent = historyLabel(selected);

    renderDetails();
    renderAnalysis();
    updateSelectedLayerUI();
    populateJumpSelector();

    if (redraw) {
      redrawMap();
    }

    document.querySelectorAll('.version-select').forEach(btn => {
      btn.classList.toggle(
        'selected',
        btn.textContent.startsWith(historyLabel(selected))
      );
    });

    openRightPanel();
  }

  function populateJumpSelector() {
    const select = $('detailVersionSelect');
    if (!select) return;
    const current = state.selected?.version;
    select.innerHTML = '<option value="">Select a version…</option>' +
      state.versions.slice().reverse().map(x =>
        `<option value="${x.version}" ${x.version === current ? 'selected' : ''}>${escapeHTML(historyLabel(x))} · ${escapeHTML(shortDate(x.timestamp))}</option>`
      ).join('');
  }

  function updateSelectedLayerUI() {
    const v = state.selected;
    $('selectedLayerLabel').textContent = v ? `${entityLabel(v.type || state.objectType, v.id)} · ${historyLabel(v)}` : 'No layer selected';
    $('selectedLayerMeta').textContent = v ? `${formatDate(v.timestamp)} · ${v.user || 'Contributor not recorded'}` : 'Choose a version from the layer list';
  }

  function renderDetails() {
    const v = state.selected;

    if (!v) return;

    const a = state.analyses.get(v.version);

    if (!a) return;

    const color = colorFor(state.yearOrder.indexOf(yearOf(v)));

    const sourceVersionLabel = state.objectType === 'changeset'
      ? (v.sourceVersion ? `Source version ${v.sourceVersion}` : `Changed object ${v.version}`)
      : `Version ${v.version}`;
    const pointTableTitle = (v.type || state.objectType) === 'node' ? 'Node position' : 'Resolved point table';
    $('rightContent').innerHTML = `
      <div class="detail-card">
        <h3>Selected snapshot</h3>

        <div class="detail-grid">
          <div class="detail-item">
            <small>VERSION</small>
            <b>${escapeHTML(sourceVersionLabel)}</b>
          </div>

          <div class="detail-item">
            <small>YEAR</small>
            <b>${escapeHTML(yearOf(v))}</b>
          </div>

          <div class="detail-item detail-full">
            <small>EDITED</small>
            <b>${escapeHTML(formatDate(v.timestamp))}</b>
          </div>

          <div class="detail-item detail-full">
            <small>CONTRIBUTOR</small>
            <b>${escapeHTML(v.user || 'Not recorded')}</b>
          </div>

          <div class="detail-item">
            <small>POINTS FOUND</small>
            <b>${a.exact} / ${a.points.length}</b>
          </div>

          <div class="detail-item">
            <small>GAPS</small>
            <b>${a.missing}</b>
          </div>
        </div>
      </div>

      <div class="detail-card">
        <h3>${escapeHTML(entityLabel(v.type || state.objectType, v.id))} information</h3>
        <div class="tag-row"><code>${escapeHTML(v.type || state.objectType)} id</code><span>${escapeHTML(v.id)}</span></div>
        <div class="tag-row"><code>changeset</code><span>${escapeHTML(v.changeset || '—')}</span></div>
        <div class="tag-row"><code>visibility</code><span>${v.visible ? 'Visible' : 'Deleted'}</span></div>
        <div class="tag-row"><code>map colour</code><span style="color:${color}">● ${color}</span></div>
      </div>

      <div class="detail-card">
        <h3>Tags in this version</h3>
        ${
          (v.tags || []).length
            ? v.tags.map(t => `
                <div class="tag-row">
                  <code>${escapeHTML(t.k)}</code>
                  <span>${escapeHTML(t.v)}</span>
                </div>
              `).join('')
            : '<p class="fine-print">No tags recorded for this version.</p>'
        }
      </div>

      <div class="detail-card">
        <h3>${escapeHTML(pointTableTitle)}</h3>
        <p class="fine-print">Coordinates are the historical positions resolved for this snapshot. Missing positions are shown as em dashes.</p>
        <div class="coordinate-table-wrap">
          <table class="coordinate-table">
            <thead><tr><th>#</th><th>Node ID</th><th>Latitude</th><th>Longitude</th><th>Status</th></tr></thead>
            <tbody>
              ${a.points.map(p => `<tr><td>${p.order}</td><td>${escapeHTML(p.id)}</td><td>${p.lat === null ? '—' : p.lat.toFixed(7)}</td><td>${p.lon === null ? '—' : p.lon.toFixed(7)}</td><td>${escapeHTML(p.status)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

  }

  function getAnnualSnapshotBounds(rows) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    const include = point => {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      minLat = Math.min(minLat, point[0]); maxLat = Math.max(maxLat, point[0]);
      minLon = Math.min(minLon, point[1]); maxLon = Math.max(maxLon, point[1]);
    };
    rows.forEach(([, row]) => {
      (row.a?.segments || []).forEach(segment => segment.forEach(include));
      (row.a?.coordinates || []).forEach(point => include([point.lat, point.lon]));
    });
    if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;

    // Keep one shared geographic frame so year-to-year geometry sizes are comparable.
    let latSpan = Math.max(maxLat - minLat, 0.00008);
    let lonSpan = Math.max(maxLon - minLon, 0.00008);
    const frameRatio = 330 / 132;
    if (lonSpan / latSpan < frameRatio) lonSpan = latSpan * frameRatio;
    else latSpan = lonSpan / frameRatio;
    const latMid = (minLat + maxLat) / 2;
    const lonMid = (minLon + maxLon) / 2;
    const padLat = latSpan * 0.09;
    const padLon = lonSpan * 0.09;
    return {
      minLat: latMid - latSpan / 2 - padLat,
      maxLat: latMid + latSpan / 2 + padLat,
      minLon: lonMid - lonSpan / 2 - padLon,
      maxLon: lonMid + lonSpan / 2 + padLon
    };
  }

  function annualSnapshotSvg(analysis, bounds, accent, year) {
    if (!bounds) return '<div class="annual-map-empty">No historical coordinates available</div>';
    const x = lon => 15 + ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 330;
    const y = lat => 12 + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * 132;
    const reducePoints = points => {
      if (!Array.isArray(points) || points.length < 1) return [];
      const step = Math.max(1, Math.ceil(points.length / 520));
      const sampled = points.filter((_, index) => index % step === 0);
      if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
      return sampled;
    };
    const makePath = (points, close = false) => {
      const valid = reducePoints(points).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (!valid.length) return '';
      const d = valid.map((p, index) => `${index ? 'L' : 'M'}${x(p[1]).toFixed(2)},${y(p[0]).toFixed(2)}`).join(' ');
      return `${d}${close ? ' Z' : ''}`;
    };

    const detected = analysis?.detectedPolygons || [];
    let shapeMarkup = '';
    if (detected.length) {
      shapeMarkup = detected.map((polygon, index) => {
        const d = makePath(polygon.coordinates, true);
        return d ? `<path d="${d}" fill="${accent}" fill-opacity=".24" stroke="${accent}" stroke-width="2.1" stroke-linejoin="round" vector-effect="non-scaling-stroke"><title>${escapeHTML(year)} · enclosed area ${escapeHTML(formatArea(polygon.areaM2))}</title></path>` : '';
      }).join('');
    } else if (analysis?.segments?.length) {
      shapeMarkup = analysis.segments.map(segment => {
        const d = makePath(segment, false);
        if (!d) return '';
        const isClosed = segment.length > 3 && Math.abs(segment[0][0] - segment[segment.length - 1][0]) < 1e-7 && Math.abs(segment[0][1] - segment[segment.length - 1][1]) < 1e-7;
        return `<path d="${d}${isClosed ? ' Z' : ''}" fill="${isClosed ? accent : 'none'}" fill-opacity="${isClosed ? '.12' : '0'}" stroke="${accent}" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      }).join('');
    }

    if (!shapeMarkup && analysis?.coordinates?.length) {
      const point = analysis.coordinates[0];
      shapeMarkup = `<circle cx="${x(point.lon).toFixed(2)}" cy="${y(point.lat).toFixed(2)}" r="5.5" fill="${accent}" stroke="#fff8ef" stroke-width="2"><title>Mapped point</title></circle>`;
    }
    if (!shapeMarkup) shapeMarkup = '<text x="180" y="82" text-anchor="middle" class="annual-svg-empty">Geometry unavailable</text>';

    return `<svg class="annual-map-svg" viewBox="0 0 360 156" role="img" aria-label="${escapeHTML(year)} historical geometry preview" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="annualGrid-${escapeHTML(year).replace(/[^a-zA-Z0-9_-]/g, '')}" width="34" height="28" patternUnits="userSpaceOnUse">
          <path d="M34 0H0V28" fill="none" stroke="#b6c6b9" stroke-width=".55" opacity=".55"/>
        </pattern>
      </defs>
      <rect width="360" height="156" fill="#e4e8dd"/>
      <rect width="360" height="156" fill="url(#annualGrid-${escapeHTML(year).replace(/[^a-zA-Z0-9_-]/g, '')})"/>
      <path d="M-15 34 C35 2 62 64 112 36 S190 5 236 31 S318 62 378 20 M-15 118 C45 84 77 140 129 106 S213 86 255 112 S328 141 378 102" fill="none" stroke="#9eb9ab" stroke-width="1.15" opacity=".7"/>
      <path d="M24 -8 C45 28 88 18 111 49 S154 88 188 68 S255 42 287 77 S320 120 350 164 M-8 76 C37 65 68 86 96 74 S147 42 178 57 S230 95 273 82 S321 57 369 68" fill="none" stroke="#a6c5d1" stroke-width="1.25" opacity=".72"/>
      <path d="M-10 146 C36 126 66 146 98 126 S154 114 189 130 S260 150 292 127 S336 116 372 132" fill="none" stroke="#c6ad8f" stroke-width="1.2" opacity=".65"/>
      ${shapeMarkup}
    </svg>`;
  }

  function renderAnalysis() {
    if (!state.selected) return;
    const v = state.selected;
    const a = state.analyses.get(v.version);
    const ordered = state.versions.slice().sort((x,y)=>Date.parse(x.timestamp)-Date.parse(y.timestamp)||x.version-y.version);
    const idx = ordered.findIndex(x=>x.version===v.version);
    const prevV = idx>0 ? ordered[idx-1] : null;
    const prev = prevV ? state.analyses.get(prevV.version) : null;
    const selectedArea = a?.networkAreaM2 ?? a?.areaM2 ?? null;
    const previousArea = prev?.networkAreaM2 ?? prev?.areaM2 ?? null;
    const deltaArea = selectedArea!=null && previousArea!=null ? selectedArea-previousArea : null;
    const distance = (p1,p2) => {
      const rad = n => n*Math.PI/180, R=6371008.8;
      const dLat=rad(p2[0]-p1[0]), dLon=rad(p2[1]-p1[1]);
      const q=Math.sin(dLat/2)**2+Math.cos(rad(p1[0]))*Math.cos(rad(p2[0]))*Math.sin(dLon/2)**2;
      return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
    };
    const lineLength = analysis => (analysis?.segments||[]).reduce((sum,seg)=>{
      for(let i=1;i<seg.length;i++) sum += distance(seg[i-1],seg[i]);
      return sum;
    },0);
    const fmtLength = m => m==null || !Number.isFinite(m) ? '—' : m>=1000 ? `${(m/1000).toLocaleString(undefined,{maximumFractionDigits:3})} km` : `${m.toLocaleString(undefined,{maximumFractionDigits:1})} m`;
    const tagMap = item => Object.fromEntries((item?.tags||[]).map(t=>[t.k,t.v]));
    const compare = (before, after) => {
      const bt=tagMap(before), at=tagMap(after), keys=new Set([...Object.keys(bt),...Object.keys(at)]);
      const tagChanges=[...keys].filter(k=>bt[k]!==at[k]).map(k=>({key:k,before:bt[k],after:at[k]}));
      const oldNodes=before?.nodeIds||[], newNodes=after?.nodeIds||[];
      const oldMembers=before?.members||[], newMembers=after?.members||[];
      const memberKey=m=>`${m.type}/${m.ref}/${m.role}`;
      return {tagChanges, addedNodes:newNodes.filter(n=>!oldNodes.includes(n)).length, removedNodes:oldNodes.filter(n=>!newNodes.includes(n)).length,
        nodeSequenceChanged:oldNodes.join(',')!==newNodes.join(','), addedMembers:newMembers.filter(m=>!oldMembers.some(x=>memberKey(x)===memberKey(m))).length,
        removedMembers:oldMembers.filter(m=>!newMembers.some(x=>memberKey(x)===memberKey(m))).length,
        visibilityChanged:before?.visible!==after?.visible};
    };
    const change = prevV ? compare(prevV,v) : null;
    const allTagKeys = new Map();
    let created=0, deleted=0, restored=0, tagChangesTotal=0, geomChanges=0;
    ordered.forEach((item,i)=>{
      (item.tags||[]).forEach(t=>allTagKeys.set(t.k,(allTagKeys.get(t.k)||0)+1));
      const prior=i?ordered[i-1]:null;
      if(!prior) created++;
      else {
        const c=compare(prior,item);
        tagChangesTotal+=c.tagChanges.length;
        if(c.nodeSequenceChanged || c.addedMembers || c.removedMembers || (item.type==='node'&&(item.lat!==prior.lat||item.lon!==prior.lon))) geomChanges++;
        if(!prior.visible&&item.visible) restored++;
        if(prior.visible&&!item.visible) deleted++;
      }
    });
    const years = [...new Set(ordered.map(yearOf))].sort((a,b)=>a==='Unknown year'?1:b==='Unknown year'?-1:Number(a)-Number(b));
    const byYear = new Map();
    ordered.forEach(item=>{
      const key=yearOf(item), aa=state.analyses.get(item.version);
      if(!byYear.has(key)) byYear.set(key,{v:item,a:aa,versions:0,created:0,modified:0,deleted:0,tags:0});
      const row=byYear.get(key); row.v=item; row.a=aa; row.versions++;
    });
    const annual=[...byYear.entries()].sort((x,y)=>x[0]==='Unknown year'?1:y[0]==='Unknown year'?-1:Number(x[0])-Number(y[0]));
    const annualBounds = getAnnualSnapshotBounds(annual);
    const annualColors = ['#397f72','#b77e49','#547eaa','#9671a3','#b55f58','#71914f','#3e9b9b','#9a8650','#5e7894','#ae6d88'];
    const measureLength = analysis => (analysis?.segments||[]).reduce((sum,segment)=>{
      for(let i=1;i<segment.length;i++) sum += distance(segment[i-1],segment[i]);
      return sum;
    },0);
    const annualCards=annual.map(([year,row],i)=>{
      const prevRow=i?annual[i-1][1]:null;
      const area=row.a?.networkAreaM2??row.a?.areaM2??null;
      const oldArea=prevRow?(prevRow.a?.networkAreaM2??prevRow.a?.areaM2??null):null;
      const length=measureLength(row.a), oldLength=prevRow?measureLength(prevRow.a):null;
      let delta=null, deltaText='First available snapshot', deltaKind='neutral';
      if(area!=null && oldArea!=null){ delta=area-oldArea; deltaText=`${delta>0?'↑':delta<0?'↓':'→'} ${delta>0?'+':''}${formatArea(delta)}`; deltaKind=delta>0?'up':delta<0?'down':'neutral'; }
      else if(area==null && oldArea==null && prevRow && Number.isFinite(length) && Number.isFinite(oldLength) && (length>0 || oldLength>0)){
        delta=length-oldLength; deltaText=`${delta>0?'↑':delta<0?'↓':'→'} ${delta>0?'+':''}${fmtLength(delta)}`; deltaKind=delta>0?'up':delta<0?'down':'neutral';
      }
      const accent=annualColors[i%annualColors.length];
      const type=(row.v.type||state.objectType||'object').toUpperCase();
      const metric=area!=null
        ? `<span class="annual-metric-label">ENCLOSED AREA</span><strong>${formatArea(area)}</strong>`
        : length>0
          ? `<span class="annual-metric-label">LINE LENGTH</span><strong>${fmtLength(length)}</strong>`
          : `<span class="annual-metric-label">GEOMETRY</span><strong>${row.a?.exact?`${row.a.exact} positions`:'Not measurable'}</strong>`;
      const secondary=area!=null && length>0 ? `<span class="annual-secondary-metric">Line length · ${fmtLength(length)}</span>` : `<span class="annual-secondary-metric">${row.a?.exact??0} positions · ${row.a?.missing??0} missing</span>`;
      const snapshotDate=new Date(row.v.timestamp);
      const dateLabel=Number.isFinite(snapshotDate.getTime())?snapshotDate.toISOString().slice(0,10):'Date not recorded';
      const mapPreview=annualSnapshotSvg(row.a,annualBounds,accent,year);
      const safeYear=escapeHTML(year);
      return `<article class="annual-snapshot" style="--snapshot-accent:${accent}">
        <button type="button" class="annual-preview-button analysis-jump" data-version="${row.v.version}" aria-label="Inspect ${safeYear} snapshot">
          ${mapPreview}
          <span class="annual-year-chip">${safeYear}</span>
          <span class="annual-map-label">${area!=null?`AREA · ${escapeHTML(formatArea(area))}`:length>0?`LENGTH · ${escapeHTML(fmtLength(length))}`:'GEOMETRY PREVIEW'}</span>
        </button>
        <div class="annual-snapshot-body">
          <div class="annual-snapshot-heading"><div><span class="annual-card-kicker">YEAR SNAPSHOT</span><h3>${safeYear}</h3></div><span class="annual-change-chip ${deltaKind}">${escapeHTML(deltaText)}</span></div>
          <div class="annual-snapshot-meta"><span>${escapeHTML(type)}</span><span>VERSION ${row.v.version}</span><span>${row.versions} ${row.versions===1?'VERSION':'VERSIONS'}</span></div>
          <div class="annual-measure">${metric}${secondary}</div>
          <div class="annual-snapshot-footer"><span>${escapeHTML(dateLabel)}</span><button type="button" class="analysis-jump" data-version="${row.v.version}">Inspect version ↗</button></div>
        </div>
      </article>`;
    }).join('');
    const tagRows=(change?.tagChanges||[]).map(t=>`<tr><td><code>${escapeHTML(t.key)}</code></td><td>${t.before==null?'—':escapeHTML(t.before)}</td><td>${t.after==null?'—':escapeHTML(t.after)}</td><td>${t.before==null?'Added':t.after==null?'Removed':'Modified'}</td></tr>`).join('');
    const typeCounts = {node:0,way:0,relation:0};
    ordered.forEach(item=>{typeCounts[item.type||state.objectType]=(typeCounts[item.type||state.objectType]||0)+1;});
    const boundary = (v.tags||[]).some(t=>t.k==='boundary'||t.k==='admin_level'||t.k==='border_type') || (v.members||[]).some(m=>m.role==='outer'||m.role==='inner');
    const lengthNow=lineLength(a), lengthPrev=lineLength(prev), lengthDelta=prev?lengthNow-lengthPrev:null;
    $('analysisContent').innerHTML = `
      <div class="analysis-hero"><div><p class="eyebrow">GEOSPATIAL CHANGE INTELLIGENCE</p><h2>Historical analysis</h2><p>Evidence-led measurements from the loaded OSM history. Results describe mapped data, not necessarily real-world change.</p></div><span class="analysis-live">● ${a?'DATA READY':'PREPARING'}</span></div>
      <div class="analysis-kpi-grid">
        <div class="analysis-kpi"><small>OBJECT VERSIONS</small><strong>${ordered.length}</strong><span>${escapeHTML(v.type||state.objectType)} ${escapeHTML(v.id||state.objectId||'')}</span></div>
        <div class="analysis-kpi"><small>YEARS COVERED</small><strong>${years.length}</strong><span>${years.length?`${years[0]}–${years[years.length-1]}`:'No dates'}</span></div>
        <div class="analysis-kpi"><small>GEOMETRY CHANGES</small><strong>${geomChanges}</strong><span>Version transitions checked</span></div>
        <div class="analysis-kpi"><small>TAG CHANGES</small><strong>${tagChangesTotal}</strong><span>Key/value transitions</span></div>
      </div>
      <details class="analysis-section" open><summary><span>01 · Object and data readiness</span><span class="section-subtitle">Inventory & provenance</span></summary>
        <div class="detail-grid">
          <div class="detail-item"><small>OBJECT TYPE</small><b>${escapeHTML(v.type||state.objectType)}</b></div>
          <div class="detail-item"><small>OBJECT ID</small><b>${escapeHTML(v.id||state.objectId||'—')}</b></div>
          <div class="detail-item"><small>NODE VERSIONS</small><b>${typeCounts.node||0}</b></div>
          <div class="detail-item"><small>WAY VERSIONS</small><b>${typeCounts.way||0}</b></div>
          <div class="detail-item"><small>RELATION VERSIONS</small><b>${typeCounts.relation||0}</b></div>
          <div class="detail-item"><small>CONTRIBUTORS PRESENT</small><b>${new Set(ordered.map(x=>x.user).filter(Boolean)).size}</b></div>
          <div class="detail-item"><small>CHANGESets REFERENCED</small><b>${new Set(ordered.map(x=>x.changeset).filter(Boolean)).size}</b></div>
          <div class="detail-item"><small>ADMIN / BOUNDARY TAGS</small><b>${boundary?'Present':'Not detected'}</b></div>
        </div>
        <p class="fine-print">Source: loaded OSM history XML or OpenStreetMap API response. Only versions available in this loaded history are counted; this is not a complete regional OSM inventory.</p>
      </details>
      <details class="analysis-section" open><summary><span>02 · Geometry and footprint</span><span class="section-subtitle">Measured from available coordinates</span></summary>
        <div class="detail-grid">
          <div class="detail-item"><small>DETECTED CLOSED AREAS</small><b>${a?.detectedPolygons?.length||0}</b></div>
          <div class="detail-item"><small>ENCLOSED AREA</small><b>${selectedArea==null?'Not defined':formatArea(selectedArea)}</b></div>
          <div class="detail-item"><small>LINE LENGTH</small><b>${fmtLength(lengthNow)}</b></div>
          <div class="detail-item"><small>LENGTH Δ VS PREVIOUS</small><b>${lengthDelta==null?'—':`${lengthDelta>0?'+':''}${fmtLength(lengthDelta)}`}</b></div>
          <div class="detail-item"><small>POSITIONS FOUND</small><b>${a?.exact||0}</b></div>
          <div class="detail-item"><small>POSITIONS MISSING</small><b>${a?.missing||0}</b></div>
        </div>
        <div class="area-stats"><div><small>NET AREA Δ VS PREVIOUS VERSION</small><b>${deltaArea==null?'—':`${deltaArea>0?'+':''}${formatArea(deltaArea)}`}</b></div><div><small>GEOMETRY STATUS</small><b>${a?.missing?'Incomplete':selectedArea!=null?'Closed ring detected':'Linear / point geometry'}</b></div></div>
        <p class="fine-print">Length uses a spherical-earth haversine calculation over available line segments. Area is shown only when the existing geometry engine detects closed linework. Net area difference is not the same as the full changed footprint; no unobserved geometry is inferred.</p>
        <label class="analysis-toggle"><input id="areaOverlayToggle" type="checkbox" ${state.showAreaOverlay?'checked':''}> Show detected polygon fills and area labels on map</label>
        <label class="analysis-toggle"><input id="areaOverlayToggleNetwork" type="checkbox" ${state.showAreaOverlay?'checked':''}> Show connected polygon overlays</label>
      </details>
      <details class="analysis-section" open><summary><span>03 · Version-to-version change log</span><span class="section-subtitle">v${prevV?.version??'—'} → v${v.version}</span></summary>
        <div class="analysis-kpi-grid compact-kpis">
          <div class="analysis-kpi"><small>NODES ADDED</small><strong>${change?.addedNodes??'—'}</strong></div>
          <div class="analysis-kpi"><small>NODES REMOVED</small><strong>${change?.removedNodes??'—'}</strong></div>
          <div class="analysis-kpi"><small>MEMBERS ADDED</small><strong>${change?.addedMembers??'—'}</strong></div>
          <div class="analysis-kpi"><small>MEMBERS REMOVED</small><strong>${change?.removedMembers??'—'}</strong></div>
        </div>
        <p class="fine-print">${prevV?`Previous timestamp: ${escapeHTML(prevV.timestamp||'not supplied')}. Selected timestamp: ${escapeHTML(v.timestamp||'not supplied')}.`: 'This is the first available version in the loaded sequence; no prior transition can be calculated.'} ${change?.visibilityChanged?'Visibility changed (created/deleted/restored status may be relevant).':''}</p>
        ${tagRows?`<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>Tag key</th><th>Previous</th><th>Selected</th><th>Change</th></tr></thead><tbody>${tagRows}</tbody></table></div>`:'<div class="analysis-empty-note">No tag key/value differences detected for this transition, or no prior version is available.</div>'}
      </details>
      <details class="analysis-section annual-section" open><summary><span>04 · Year-by-year geometry</span><span class="section-subtitle">${annual.length} yearly snapshots</span></summary>
        <div class="analysis-snapshot-grid">${annualCards||'<div class="analysis-empty-note">No dated versions are available in this history.</div>'}</div>
        <p class="fine-print">Each tile shows the latest loaded version for that year, drawn in one shared map frame for visual comparison. Closed geometry is measured as area; open ways are reported by line length. Missing or incomplete geometry is never estimated.</p>
      </details>
      <details class="analysis-section"><summary><span>05 · Tag intelligence</span><span class="section-subtitle">${allTagKeys.size} distinct keys observed</span></summary>
        <div class="tag-cloud">${[...allTagKeys.entries()].sort((x,y)=>y[1]-x[1]).map(([key,count])=>`<span class="tag-pill"><code>${escapeHTML(key)}</code><b>${count}</b></span>`).join('')||'<span class="fine-print">No tags in loaded versions.</span>'}</div>
        <p class="fine-print">Counts represent appearances of a tag key across loaded versions, not a count of real-world features.</p>
      </details>
      <details class="analysis-section"><summary><span>06 · Export and report</span><span class="section-subtitle">Portable outputs</span></summary>
        <div class="analysis-export-actions"><button type="button" class="button button-primary" id="analysisGeoJSON">Export GeoJSON</button><button type="button" class="button button-quiet" id="analysisCSV">Export point CSV</button><button type="button" class="button button-quiet" id="analysisKML">Export KML</button><button type="button" class="button button-quiet" id="analysisReport">Print / Save PDF report</button></div>
        <p class="fine-print">The PDF option opens the browser print dialog; choose “Save as PDF”. Export geometry is limited to what was successfully reconstructed in the browser.</p>
      </details>`;
    const overlayHandler=e=>{state.showAreaOverlay=e.target.checked;redrawMap();renderAnalysis();};
    $('areaOverlayToggle')?.addEventListener('change',overlayHandler);
    $('areaOverlayToggleNetwork')?.addEventListener('change',overlayHandler);
    $('analysisContent').querySelectorAll('.analysis-jump').forEach(btn=>btn.addEventListener('click',()=>selectVersion(Number(btn.dataset.version))));
    $('analysisGeoJSON')?.addEventListener('click',()=>exportGeoJSON(true));
    $('analysisCSV')?.addEventListener('click',()=>exportCSV());
    $('analysisKML')?.addEventListener('click',exportKML);
    $('analysisReport')?.addEventListener('click',()=>window.print());
  }

  function exportKML() {
    if (!state.versions.length) return;
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const placemarks = state.versions.map(v=>{
      const a=state.analyses.get(v.version); if(!a) return '';
      let geometry='';
      if((v.type||state.objectType)==='node' && a.coordinates[0]) {
        const p=a.coordinates[0]; geometry=`<Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>`;
      } else {
        const coords=(a.segments||[]).filter(seg=>seg.length>1).map(seg=>seg.map(p=>`${p[1]},${p[0]},0`).join(' '));
        if(coords.length===1) geometry=`<LineString><tessellate>1</tessellate><coordinates>${coords[0]}</coordinates></LineString>`;
        else if(coords.length>1) geometry=`<MultiGeometry>${coords.map(c=>`<LineString><tessellate>1</tessellate><coordinates>${c}</coordinates></LineString>`).join('')}</MultiGeometry>`;
      }
      if(!geometry) return '';
      return `<Placemark><name>${esc(`${v.type||state.objectType} ${v.id} v${v.sourceVersion||v.version}`)}</name><description>${esc(`Timestamp: ${v.timestamp}; user: ${v.user}; changeset: ${v.changeset}`)}</description><TimeStamp><when>${esc(v.timestamp||'')}</when></TimeStamp>${geometry}</Placemark>`;
    }).join('');
    downloadBlob(`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(`OSM ${state.objectType} ${state.objectId} history`)}</name>${placemarks}</Document></kml>`,'application/vnd.google-earth.kml+xml',`${state.objectType}-${state.objectId}-history.kml`);
    toast('KML export created from available reconstructed points and lines.');
  }

  function showPanel(name) {
    const panels = {
      layers: 'layersPanel',
      analysis: 'analysisPanel',
      basemap: 'basemapPanel',
      help: 'helpPanel'
    };

    Object.entries(panels).forEach(([key, id]) => {
      $(id).hidden = key !== name;
    });

    $('panelTitle').textContent = {
      layers: 'Layers',
      analysis: 'Analysis',
      basemap: 'Basemap',
      help: 'Quick guide'
    }[name];

    $('panelEyebrow').textContent = {
      layers: 'MAP CONTENT',
      analysis: 'OBJECT INSIGHTS',
      basemap: 'MAP STYLE',
      help: 'GETTING STARTED'
    }[name];

    document.querySelectorAll('.rail-button').forEach(btn => {
      const active = btn.dataset.panel === name;

      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    $('leftPanel').classList.add('open');
    document.querySelector('.app-shell')?.classList.toggle('analysis-mode', name === 'analysis');
    if (name !== 'analysis' && state.map) {
      window.requestAnimationFrame(() => state.map?.invalidateSize({ pan: false }));
    }
  }

  function openRightPanel() {
    $('rightPanel').classList.add('open');
  }

  function togglePoints() {
    state.showPoints = !state.showPoints;

    $('pointsBtn').classList.toggle('active', state.showPoints);
    $('pointsBtn').title = state.showPoints ? 'Hide points' : 'Show points';
    $('pointsBtn').setAttribute('aria-pressed', String(state.showPoints));

    redrawMap();
  }

  function showAll(visible) {
    state.versions.forEach(v => {
      state.layers.set(v.version, visible);
    });

    renderLayers();
    redrawMap();
  }

  function makeFeature(version) {
    const a = state.analyses.get(version.version);

    if (!a) return null;

    const objectType = version.type || state.objectType;
    const geometry = objectType === 'node'
      ? (a.coordinates[0] ? { type: 'Point', coordinates: [a.coordinates[0].lon, a.coordinates[0].lat] } : null)
      : a.segments.length === 0
        ? null
        : a.segments.length === 1
          ? { type: 'LineString', coordinates: a.segments[0].map(([lat, lon]) => [lon, lat]) }
          : { type: 'MultiLineString', coordinates: a.segments.map(seg => seg.map(([lat, lon]) => [lon, lat])) };

    return {
      type: 'Feature',
      geometry,
      properties: {
        object_type: objectType,
        object_id: version.id,
        version: version.sourceVersion || version.version,
        timestamp: version.timestamp,
        user: version.user,
        changeset: version.changeset,
        visible: version.visible,
        point_count: a.points.length,
        points_found: a.exact,
        points_missing: a.missing,
        tags: Object.fromEntries((version.tags || []).map(t => [t.k, t.v]))
      }
    };
  }

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;

    document.body.append(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportGeoJSON(all) {
    if (!state.selected) return;

    const versions = all ? state.versions : [state.selected];
    const features = versions.map(makeFeature).filter(Boolean);

    const output = {
      type: 'FeatureCollection',
      name: `OSM ${state.objectType} ${state.objectId} history`,
      features
    };

    downloadBlob(
      JSON.stringify(output, null, 2),
      'application/geo+json',
      `${state.objectType}-${state.objectId}-${all ? 'all-versions' : `v${state.selected.version}`}.geojson`
    );

    toast(`Exported ${features.length} ${features.length === 1 ? 'version' : 'versions'} as GeoJSON.`);
  }

  function exportCSV() {
    if (!state.versions.length) return;

    const rows = [[
      'object_type',
      'object_id',
      'object_version',
      'timestamp',
      'user',
      'point_order',
      'node_id',
      'latitude',
      'longitude',
      'position_status'
    ]];

    [state.selected].filter(Boolean).forEach(v => {
      const a = state.analyses.get(v.version);

      if (!a) return;

      a.points.forEach(p => {
        rows.push([
          v.type || state.objectType,
          v.id,
          v.sourceVersion || v.version,
          v.timestamp,
          v.user,
          p.order,
          p.id,
          p.lat ?? '',
          p.lon ?? '',
          p.status
        ]);
      });
    });

    const csv = rows.map(row =>
      row.map(value => {
        let s = String(value ?? '');

        if (/^[\s]*[=+@]/.test(s) || /^[\s]*-(?=[A-Za-z])/.test(s)) {
          s = "'" + s;
        }

        return `"${s.replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\r\n');

    downloadBlob(
      '\ufeff' + csv,
      'text/csv;charset=utf-8',
      `${state.objectType}-${state.objectId}-point-audit.csv`
    );

    toast('Point audit CSV exported.');
  }

  function exportMenu() {
    if (state.versions.length) {
      $('exportDialog').hidden = false;
    }
  }

  function closeExportMenu() {
    $('exportDialog').hidden = true;
  }

  // Header upload, keyboard access and responsive panels.

  $('emptyUploadBtn').addEventListener('click', () => $('xmlFile').click());
  $('headerUploadBtn').addEventListener('click', () => $('xmlFile').click());

  $('xmlFile').addEventListener('change', e => {
    const file = e.target.files?.[0];

    if (file) {
      handleFile(file);
      e.target.value = '';
    }
  });

  $('detailVersionSelect').addEventListener('change', e => {
    if (e.target.value) selectVersion(Number(e.target.value));
  });

  async function searchPlaceOrCoordinates(query) {
    const value = String(query || '').trim();
    if (!value) { toast('Enter a place name or latitude, longitude.'); return; }
    if (!state.map) { toast('The map is not available yet.'); return; }

    // Coordinate input is local and does not call a geocoding provider.
    const pair = value.match(/^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
    if (pair) {
      const lat = Number(pair[1]);
      const lon = Number(pair[2]);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        toast('Coordinates are out of range. Use latitude −90 to 90 and longitude −180 to 180.');
        return;
      }
      showPlaceResult(lat, lon, `${lat.toFixed(6)}, ${lon.toFixed(6)}`, 15);
      return;
    }

    const button = $('placeSearchBtn');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Searching…';
    try {
      // Photon is used only for an explicit user-submitted search (never autocomplete).
      // The public demo has fair-use limits and no uptime guarantee; throttle each browser to <=1 req/sec.
      const wait = Math.max(0, 1000 - (Date.now() - state.lastGeocodeAt));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      state.lastGeocodeAt = Date.now();
      const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(value)}`;
      const response = await fetch(url, { headers: { Accept: 'application/geo+json' }, referrerPolicy: 'strict-origin-when-cross-origin' });
      if (!response.ok) throw new Error(`Place search returned HTTP ${response.status}. Try coordinates or retry later.`);
      const data = await response.json();
      const results = Array.isArray(data?.features) ? data.features : [];
      if (!results.length) throw new Error(`No place found for “${value}”. Try a more specific place name or latitude, longitude.`);
      const result = results[0];
      const lon = Number(result.geometry?.coordinates?.[0]);
      const lat = Number(result.geometry?.coordinates?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('The place search returned invalid coordinates.');
      const props = result.properties || {};
      const label = [props.name, props.street, props.city || props.locality, props.state, props.country]
        .filter((part, index, array) => part && array.indexOf(part) === index)
        .join(', ') || props.label || value;
      showPlaceResult(lat, lon, label, 14);
    } catch (error) {
      toast(error.message || 'Could not search for this place.');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function showPlaceResult(lat, lon, label, zoom) {
    if (state.searchMarker && state.map) state.map.removeLayer(state.searchMarker);
    state.searchMarker = L.marker([lat, lon], { title: label })
      .bindPopup(`<strong>${escapeHTML(label)}</strong><br><small>Coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}</small>`);
    state.searchMarker.addTo(state.map).openPopup();
    state.map.setView([lat, lon], zoom, { animate: true, duration: 0.6 });
  }

  $('placeSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    searchPlaceOrCoordinates($('placeSearchInput').value);
  });

  $('placeSearchInput').addEventListener('keydown', event => {
    if (event.key === 'Escape') $('placeSearchInput').blur();
  });

  $('objectSearchBtn').addEventListener('click', async () => {
    const type = $('objectSearchType').value;
    const id = $('objectSearchId').value.trim();
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) {
      $('objectSearchId').setCustomValidity('Enter a numeric OpenStreetMap ID.');
      $('objectSearchId').reportValidity();
      toast('Enter a valid numeric OSM ID.');
      return;
    }
    $('objectSearchId').setCustomValidity('');
    const button = $('objectSearchBtn');
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Loading…';
    try {
      const endpoint = type === 'changeset'
        ? `${API}/changeset/${encodeURIComponent(id)}/download`
        : `${API}/${type}/${encodeURIComponent(id)}/history`;
      const response = await fetch(endpoint, { headers: { Accept: 'application/xml' } });
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          throw new Error(`${entityLabel(type, id)} was not found or is no longer available.`);
        }
        if (response.status === 429) throw new Error('The OpenStreetMap API is rate-limiting requests. Please wait a moment and retry.');
        throw new Error(`OpenStreetMap API returned ${response.status} for ${entityLabel(type, id)}.`);
      }
      const xml = await response.text();
      await handleFile(new File([xml], `${type}-${id}-${type === 'changeset' ? 'download' : 'history'}.xml`, { type: 'application/xml' }));
    } catch (error) {
      toast(error.message || `Could not load ${type} ${id}.`);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  });
  $('objectSearchId').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('objectSearchBtn').click();
  });

  $('exportBtn').addEventListener('click', exportMenu);

  $('exportDialogClose').addEventListener('click', closeExportMenu);

  $('exportDialog').addEventListener('click', e => {
    if (e.target === $('exportDialog')) {
      closeExportMenu();
    }
  });

  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.export;

      closeExportMenu();

      if (kind === 'selected') {
        exportGeoJSON(false);
      } else if (kind === 'all') {
        exportGeoJSON(true);
      } else {
        exportCSV();
      }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeExportMenu();
    }
  });

  document.querySelectorAll('.rail-button').forEach(btn => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  $('pointsBtn').addEventListener('click', togglePoints);
  document.querySelectorAll('[data-basemap]').forEach(button => {
    button.addEventListener('click', () => setBasemap(button.dataset.basemap));
  });

  $('showAllBtn').addEventListener('click', () => showAll(true));
  $('hideAllBtn').addEventListener('click', () => showAll(false));

  $('yearSearch').addEventListener('input', filterYears);

  // A file can also be dropped on the map without navigating away from the app.

  const mapArea = document.querySelector('.map-area');

  ['dragenter', 'dragover'].forEach(type => {
    mapArea.addEventListener(type, e => {
      e.preventDefault();
      mapArea.classList.add('drag-active');
    });
  });

  ['dragleave', 'drop'].forEach(type => {
    mapArea.addEventListener(type, e => {
      e.preventDefault();
      mapArea.classList.remove('drag-active');
    });
  });

  mapArea.addEventListener('drop', e => {
    const file = [...(e.dataTransfer?.files || [])]
      .find(f => /\.(xml|osm)$/i.test(f.name));

    if (file) {
      handleFile(file);
    } else {
      toast('Drop an XML or OSM file here.');
    }
  });

  window.addEventListener('resize', () => {
    if (state.map) {
      state.map.invalidateSize({ pan: false });
    }
  });

  window.addEventListener('beforeunload', () => {
    state.generation++;
  });

  initMap();
  showPanel('layers');
})();