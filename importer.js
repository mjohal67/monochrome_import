(async () => {
  'use strict';

  const CONFIG = {
    concurrency: 3,
    timeoutMs: 12000,
    databaseName: 'MonochromeDB',
    databaseVersion: 11,
    playlistStore: 'user_playlists',
  };

  const FALLBACK_ENDPOINTS = [
    'https://hifi.geeked.wtf',
    'https://eu-central.monochrome.tf',
    'https://us-west.monochrome.tf',
    'https://api.monochrome.tf',
    'https://monochrome-api.samidy.com',
  ];

  const existingOverlay = document.getElementById(
    'mc-fast-importer'
  );

  if (existingOverlay) {
    existingOverlay.remove();
  }

  document
    .getElementById('mc-fast-importer-style')
    ?.remove();

  function normaliseText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(
        /\b(feat|ft|featuring)\.?\b.*$/i,
        ''
      )
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function splitArtists(value) {
    return String(value || '')
      .split(
        /\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i
      )
      .map(normaliseText)
      .filter(Boolean);
  }

  function calculateTitleScore(expected, actual) {
    const first = normaliseText(expected);
    const second = normaliseText(actual);

    if (!first || !second) {
      return 0;
    }

    if (first === second) {
      return 1;
    }

    if (
      first.includes(second) ||
      second.includes(first)
    ) {
      return 0.86;
    }

    const firstWords = new Set(
      first.split(/\s+/)
    );

    const secondWords = new Set(
      second.split(/\s+/)
    );

    const sharedWords = [...firstWords].filter(
      (word) => secondWords.has(word)
    ).length;

    const allWords = new Set([
      ...firstWords,
      ...secondWords,
    ]).size;

    return allWords
      ? sharedWords / allWords
      : 0;
  }

  function calculateArtistScore(
    expectedArtists,
    track
  ) {
    const wantedArtists =
      splitArtists(expectedArtists);

    const actualArtists = [
      track?.artist?.name,
      typeof track?.artist === 'string'
        ? track.artist
        : '',
      ...(Array.isArray(track?.artists)
        ? track.artists.map(
            (artist) =>
              artist?.name || artist
          )
        : []),
    ]
      .map(normaliseText)
      .filter(Boolean);

    if (
      !wantedArtists.length ||
      !actualArtists.length
    ) {
      return 0;
    }

    const matches = wantedArtists.filter(
      (wantedArtist) =>
        actualArtists.some(
          (actualArtist) =>
            actualArtist === wantedArtist ||
            actualArtist.includes(
              wantedArtist
            ) ||
            wantedArtist.includes(
              actualArtist
            )
        )
    );

    return (
      matches.length /
      wantedArtists.length
    );
  }

  function normaliseIsrc(value) {
    return String(value || '')
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase();
  }

  function isSameIsrc(first, second) {
    const firstCode =
      normaliseIsrc(first);

    const secondCode =
      normaliseIsrc(second);

    return Boolean(
      firstCode &&
        secondCode &&
        firstCode === secondCode
    );
  }

  function parseCsvLine(line) {
    const fields = [];

    let currentValue = '';
    let insideQuotes = false;

    for (
      let index = 0;
      index < line.length;
      index += 1
    ) {
      const character = line[index];

      if (character === '"') {
        if (
          insideQuotes &&
          line[index + 1] === '"'
        ) {
          currentValue += '"';
          index += 1;
        } else {
          insideQuotes =
            !insideQuotes;
        }
      } else if (
        character === ',' &&
        !insideQuotes
      ) {
        fields.push(
          currentValue.trim()
        );

        currentValue = '';
      } else {
        currentValue += character;
      }
    }

    fields.push(currentValue.trim());

    return fields;
  }

  function parseTrackInput(text) {
    const lines = String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return [];
    }

    const header = parseCsvLine(
      lines[0]
    ).map((value) =>
      value.toLowerCase()
    );

    const titleIndex =
      header.findIndex((value) =>
        [
          'track name',
          'title',
          'song',
          'name',
        ].includes(value)
      );

    const artistIndex =
      header.findIndex((value) =>
        [
          'artist name(s)',
          'artist name',
          'artist',
          'artists',
        ].includes(value)
      );

    const isrcIndex =
      header.findIndex(
        (value) => value === 'isrc'
      );

    if (
      titleIndex >= 0 &&
      artistIndex >= 0
    ) {
      return lines
        .slice(1)
        .map((line) => {
          const values =
            parseCsvLine(line);

          return {
            title:
              values[titleIndex]
                ?.trim() || '',
            artists:
              values[artistIndex]
                ?.trim() || '',
            isrc:
              isrcIndex >= 0
                ? values[isrcIndex]
                    ?.trim() || ''
                : '',
          };
        })
        .filter(
          (track) =>
            track.title &&
            track.artists
        );
    }

    return lines
      .map((line) => {
        const separatorIndex =
          line.indexOf(' - ');

        if (separatorIndex < 1) {
          return null;
        }

        return {
          artists: line
            .slice(0, separatorIndex)
            .trim(),

          title: line
            .slice(separatorIndex + 3)
            .trim(),

          isrc: '',
        };
      })
      .filter(Boolean);
  }

  function getApiEndpoints() {
    const endpoints = [];

    function addEndpoint(entry) {
      const value =
        typeof entry === 'string'
          ? entry
          : entry?.url;

      if (
        !value ||
        !/^https?:\/\//i.test(value)
      ) {
        return;
      }

      const cleaned =
        value.replace(/\/+$/, '');

      if (
        !endpoints.includes(cleaned)
      ) {
        endpoints.push(cleaned);
      }
    }

    const storageKeys = [
      'monochrome-user-api-instances-v1',
      'monochrome-api-instances-v9',
    ];

    for (const key of storageKeys) {
      try {
        const parsed = JSON.parse(
          localStorage.getItem(key) ||
            'null'
        );

        const source =
          parsed?.data || parsed;

        const savedEndpoints =
          source?.api || [];

        savedEndpoints.forEach(
          addEndpoint
        );
      } catch {
        // Ignore invalid settings.
      }
    }

    FALLBACK_ENDPOINTS.forEach(
      addEndpoint
    );

    return endpoints;
  }

  async function fetchJsonWithTimeout(
    url
  ) {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      CONFIG.timeoutMs
    );

    try {
      const response = await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            Accept:
              'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function extractTrackItems(payload) {
    const possibleLists = [
      payload?.items,
      payload?.tracks?.items,
      payload?.data?.items,
      payload?.data?.tracks
        ?.items,
      payload?.data,
      payload,
    ];

    for (
      const possibleList of
      possibleLists
    ) {
      if (
        Array.isArray(possibleList)
      ) {
        return possibleList;
      }
    }

    return [];
  }

  function normaliseTrack(track) {
    if (
      !track ||
      track.id == null
    ) {
      return null;
    }

    const artists = Array.isArray(
      track.artists
    )
      ? track.artists.map(
          (artist) => ({
            id:
              artist?.id ?? null,

            name:
              artist?.name ||
              String(artist || ''),
          })
        )
      : track.artist
        ? [
            {
              id:
                track.artist?.id ??
                null,

              name:
                track.artist?.name ||
                String(
                  track.artist || ''
                ),
            },
          ]
        : [];

    return {
      ...track,

      id: track.id,

      title:
        track.title ||
        track.name ||
        'Unknown track',

      duration:
        track.duration || 0,

      explicit:
        Boolean(track.explicit),

      artist:
        track.artist ||
        artists[0] ||
        null,

      artists,

      album: track.album
        ? {
            ...track.album,

            id:
              track.album.id ??
              null,

            title:
              track.album.title ||
              track.album.name ||
              null,

            cover:
              track.album.cover ||
              track.album.image ||
              null,
          }
        : null,

      isrc:
        track.isrc || null,

      type: 'track',
    };
  }

  async function searchApi(path) {
    const endpointErrors = [];

    const endpoints =
      getApiEndpoints();

    for (
      const endpoint of
      endpoints.slice(0, 3)
    ) {
      try {
        const response =
          await fetchJsonWithTimeout(
            endpoint + path
          );

        const tracks =
          extractTrackItems(response)
            .map(normaliseTrack)
            .filter(Boolean);

        if (tracks.length) {
          return tracks;
        }
      } catch (error) {
        const message =
          error?.name ===
          'AbortError'
            ? 'timeout'
            : error?.message ||
              String(error);

        endpointErrors.push(
          `${endpoint}: ${message}`
        );
      }
    }

    throw new Error(
      endpointErrors.join(' | ') ||
        'No API response'
    );
  }

  function chooseBestMatch(
    requestedTrack,
    candidates
  ) {
    for (const candidate of candidates) {
      if (
        isSameIsrc(
          requestedTrack.isrc,
          candidate.isrc
        )
      ) {
        return {
          track: candidate,
          score: 1,
          method: 'ISRC',
        };
      }
    }

    let bestTrack = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score =
        calculateTitleScore(
          requestedTrack.title,
          candidate.title
        ) *
          0.62 +
        calculateArtistScore(
          requestedTrack.artists,
          candidate
        ) *
          0.38;

      if (score > bestScore) {
        bestScore = score;
        bestTrack = candidate;
      }
    }

    if (
      bestTrack &&
      bestScore >= 0.58
    ) {
      return {
        track: bestTrack,
        score: bestScore,
        method:
          'title and artist',
      };
    }

    return null;
  }

  async function resolveTrack(
    requestedTrack
  ) {
    if (requestedTrack.isrc) {
      try {
        const isrcResults =
          await searchApi(
            `/search/?i=${encodeURIComponent(
              requestedTrack.isrc
            )}`
          );

        const exactMatch =
          isrcResults.find((track) =>
            isSameIsrc(
              requestedTrack.isrc,
              track.isrc
            )
          );

        if (exactMatch) {
          return {
            requestedTrack,
            track: exactMatch,
            score: 1,
            method: 'ISRC',
          };
        }
      } catch {
        // Fall back to text search.
      }
    }

    try {
      const query =
        `"${requestedTrack.title}" ` +
        requestedTrack.artists;

      const textResults =
        await searchApi(
          `/search/?s=${encodeURIComponent(
            query
          )}`
        );

      const match =
        chooseBestMatch(
          requestedTrack,
          textResults
        );

      if (match) {
        return {
          requestedTrack,
          ...match,
        };
      }

      return {
        requestedTrack,
        error:
          'No sufficiently close match',
      };
    } catch (error) {
      return {
        requestedTrack,
        error:
          error?.message ||
          String(error),
      };
    }
  }

  async function processWithConcurrency(
    tracks,
    worker,
    onResult
  ) {
    const results =
      new Array(tracks.length);

    let nextIndex = 0;

    async function runWorker() {
      while (true) {
        const currentIndex =
          nextIndex;

        nextIndex += 1;

        if (
          currentIndex >=
          tracks.length
        ) {
          return;
        }

        try {
          results[currentIndex] =
            await worker(
              tracks[currentIndex]
            );
        } catch (error) {
          results[currentIndex] = {
            requestedTrack:
              tracks[currentIndex],

            error:
              error?.message ||
              String(error),
          };
        }

        onResult(
          results[currentIndex]
        );
      }
    }

    const workers =
      Array.from(
        {
          length: Math.min(
            CONFIG.concurrency,
            tracks.length
          ),
        },
        () => runWorker()
      );

    await Promise.all(workers);

    return results;
  }

  function createCompactTrack(track) {
    return {
      id: track.id,

      addedAt: Date.now(),

      title:
        track.title || null,

      duration:
        track.duration || null,

      explicit:
        Boolean(track.explicit),

      artist:
        track.artist ||
        track.artists?.[0] ||
        null,

      artists:
        (track.artists || []).map(
          (artist) => ({
            id:
              artist?.id ?? null,

            name:
              artist?.name || null,
          })
        ),

      album: track.album
        ? {
            id:
              track.album.id ??
              null,

            title:
              track.album.title ||
              null,

            cover:
              track.album.cover ||
              null,

            releaseDate:
              track.album
                .releaseDate ||
              null,

            vibrantColor:
              track.album
                .vibrantColor ||
              null,

            artist:
              track.album.artist ||
              null,

            numberOfTracks:
              track.album
                .numberOfTracks ||
              null,

            mediaMetadata:
              track.album
                .mediaMetadata
                ? {
                    tags:
                      track.album
                        .mediaMetadata
                        .tags,
                  }
                : null,
          }
        : null,

      isrc:
        track.isrc || null,

      trackNumber:
        track.trackNumber || null,

      type: 'track',
    };
  }

  async function openMonochromeDatabase() {
    return await new Promise(
      (resolve, reject) => {
        const request =
          indexedDB.open(
            CONFIG.databaseName,
            CONFIG.databaseVersion
          );

        request.onsuccess =
          () =>
            resolve(
              request.result
            );

        request.onerror =
          () =>
            reject(
              request.error
            );

        request.onupgradeneeded =
          () =>
            reject(
              new Error(
                'Monochrome database is not ready. Reload the page, then run the script again.'
              )
            );
      }
    );
  }

  async function savePlaylist(
    playlistName,
    tracks
  ) {
    const database =
      await openMonochromeDatabase();

    if (
      !database.objectStoreNames.contains(
        CONFIG.playlistStore
      )
    ) {
      throw new Error(
        `Could not find IndexedDB store: ${CONFIG.playlistStore}`
      );
    }

    const seenTrackIds =
      new Set();

    const uniqueTracks = tracks
      .filter((track) => {
        const trackId =
          String(track.id);

        if (
          seenTrackIds.has(trackId)
        ) {
          return false;
        }

        seenTrackIds.add(trackId);

        return true;
      })
      .map(createCompactTrack);

    const now = Date.now();

    const playlist = {
      id: crypto.randomUUID(),

      name: playlistName,

      tracks: uniqueTracks,

      cover: '',

      description:
        'Imported with fast console importer',

      createdAt: now,

      updatedAt: now,

      numberOfTracks:
        uniqueTracks.length,

      images: [
        ...new Set(
          uniqueTracks
            .map(
              (track) =>
                track.album?.cover
            )
            .filter(Boolean)
        ),
      ].slice(0, 4),
    };

    await new Promise(
      (resolve, reject) => {
        const transaction =
          database.transaction(
            CONFIG.playlistStore,
            'readwrite'
          );

        const store =
          transaction.objectStore(
            CONFIG.playlistStore
          );

        store.put(playlist);

        transaction.oncomplete =
          () => resolve();

        transaction.onerror =
          () =>
            reject(
              transaction.error
            );

        transaction.onabort =
          () =>
            reject(
              transaction.error
            );
      }
    );

    window.dispatchEvent(
      new CustomEvent(
        'sync-playlist-change',
        {
          detail: {
            action: 'create',
            playlist,
          },
        }
      )
    );

    window.dispatchEvent(
      new CustomEvent(
        'playlist-tracks-changed'
      )
    );

    return playlist;
  }

  function downloadFailedTracks(
    results,
    playlistName
  ) {
    const failedResults =
      results.filter(
        (result) =>
          !result?.track
      );

    if (!failedResults.length) {
      return;
    }

    const quoteCsv = (value) =>
      `"${String(value || '').replace(
        /"/g,
        '""'
      )}"`;

    const rows = [
      [
        'Track Name',
        'Artist Name(s)',
        'ISRC',
        'Failure reason',
      ]
        .map(quoteCsv)
        .join(','),

      ...failedResults.map(
        (result) =>
          [
            result.requestedTrack
              .title,

            result.requestedTrack
              .artists,

            result.requestedTrack
              .isrc,

            result.error,
          ]
            .map(quoteCsv)
            .join(',')
      ),
    ];

    const blob = new Blob(
      [
        '\uFEFF' +
          rows.join('\n'),
      ],
      {
        type:
          'text/csv;charset=utf-8',
      }
    );

    const link =
      document.createElement('a');

    link.href =
      URL.createObjectURL(blob);

    link.download =
      playlistName
        .replace(
          /[^\w.-]+/g,
          '_'
        ) +
      '_failed_tracks.csv';

    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(
        link.href
      );
    }, 2000);
  }

  const style =
    document.createElement('style');

  style.id =
    'mc-fast-importer-style';

  style.textContent = `
    #mc-fast-importer {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;

      display: grid !important;
      place-items: center !important;

      padding: 20px !important;

      background:
        rgba(0, 0, 0, 0.78) !important;

      font-family:
        system-ui,
        -apple-system,
        sans-serif !important;
    }

    #mc-fast-importer * {
      box-sizing:
        border-box !important;
    }

    #mc-fast-importer .mcfi-box {
      position: relative !important;

      width:
        min(760px, 96vw) !important;

      max-height:
        92vh !important;

      overflow-y:
        auto !important;

      padding:
        22px !important;

      border:
        1px solid #555 !important;

      border-radius:
        14px !important;

      background:
        #171717 !important;

      color:
        #f4f4f4 !important;

      box-shadow:
        0 20px 80px
        rgba(0, 0, 0, 0.8) !important;
    }

    #mc-fast-importer h2 {
      margin:
        0 48px 8px 0 !important;

      color:
        #ffffff !important;

      font-size:
        24px !important;
    }

    #mc-fast-importer p {
      color:
        #c5c5c5 !important;
    }

    #mc-fast-importer label {
      display:
        block !important;

      margin-top:
        15px !important;

      color:
        #eeeeee !important;

      font-size:
        14px !important;

      font-weight:
        600 !important;
    }

    #mc-fast-importer input,
    #mc-fast-importer textarea {
      display:
        block !important;

      width:
        100% !important;

      margin-top:
        7px !important;

      padding:
        11px !important;

      border:
        1px solid #606060 !important;

      border-radius:
        8px !important;

      background:
        #090909 !important;

      color:
        #ffffff !important;

      font-family:
        inherit !important;

      font-size:
        14px !important;

      opacity:
        1 !important;

      visibility:
        visible !important;
    }

    #mc-fast-importer textarea {
      min-height:
        250px !important;

      resize:
        vertical !important;

      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace !important;
    }

    #mc-fast-importer .mcfi-go {
      display:
        block !important;

      width:
        100% !important;

      min-height:
        50px !important;

      margin:
        18px 0 10px !important;

      padding:
        13px 18px !important;

      border:
        2px solid #ffffff !important;

      border-radius:
        9px !important;

      background:
        #ffffff !important;

      color:
        #111111 !important;

      font-family:
        system-ui,
        sans-serif !important;

      font-size:
        15px !important;

      font-weight:
        750 !important;

      line-height:
        1.2 !important;

      text-align:
        center !important;

      opacity:
        1 !important;

      visibility:
        visible !important;

      cursor:
        pointer !important;
    }

    #mc-fast-importer .mcfi-go:hover {
      background:
        #dddddd !important;
    }

    #mc-fast-importer .mcfi-go:disabled {
      opacity:
        0.55 !important;

      cursor:
        wait !important;
    }

    #mc-fast-importer .mcfi-close {
      display:
        grid !important;

      place-items:
        center !important;

      position:
        absolute !important;

      top:
        12px !important;

      right:
        12px !important;

      z-index:
        5 !important;

      width:
        38px !important;

      height:
        38px !important;

      padding:
        0 !important;

      border:
        1px solid #777 !important;

      border-radius:
        50% !important;

      background:
        #333333 !important;

      color:
        #ffffff !important;

      font-size:
        25px !important;

      font-weight:
        400 !important;

      line-height:
        1 !important;

      opacity:
        1 !important;

      visibility:
        visible !important;

      cursor:
        pointer !important;
    }

    #mc-fast-importer .mcfi-status {
      display:
        block !important;

      min-height:
        22px !important;

      margin-top:
        10px !important;

      color:
        #ffffff !important;
    }

    #mc-fast-importer progress {
      display:
        block !important;

      width:
        100% !important;

      height:
        14px !important;

      margin:
        10px 0 !important;

      opacity:
        1 !important;

      visibility:
        visible !important;
    }

    #mc-fast-importer .mcfi-log {
      display:
        block !important;

      width:
        100% !important;

      min-height:
        70px !important;

      max-height:
        220px !important;

      overflow-y:
        auto !important;

      margin:
        10px 0 0 !important;

      padding:
        11px !important;

      border-radius:
        8px !important;

      background:
        #090909 !important;

      color:
        #cccccc !important;

      white-space:
        pre-wrap !important;

      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace !important;

      font-size:
        12px !important;
    }
  `;

  document.head.appendChild(style);

  const overlay =
    document.createElement('div');

  overlay.id =
    'mc-fast-importer';

  overlay.innerHTML = `
    <div class="mcfi-box">
      <button
        type="button"
        class="mcfi-close"
        aria-label="Close"
      >
        ×
      </button>

      <h2>
        Fast Monochrome importer
      </h2>

      <p>
        Paste lines formatted as
        <code>Artist - Track</code>,
        or select an Exportify CSV.
      </p>

      <label>
        Playlist name

        <input
          class="mcfi-name"
          type="text"
          value="Angry Techstep"
        >
      </label>

      <label>
        CSV or text file

        <input
          class="mcfi-file"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
        >
      </label>

      <label>
        Track list

        <textarea
          class="mcfi-text"
          placeholder="Amoss - Tinnies & Ciggies
Amoss, Molecular - Twin City
Break, Total Science - Betamax"
        ></textarea>
      </label>

      <button
        type="button"
        class="mcfi-go"
      >
        Find tracks and create playlist
      </button>

      <div class="mcfi-status">
        Ready.
      </div>

      <progress
        class="mcfi-progress"
        max="1"
        value="0"
      ></progress>

      <pre class="mcfi-log"></pre>
    </div>
  `;

  document.body.appendChild(overlay);

  const select = (selector) =>
    overlay.querySelector(selector);

  const closeButton =
    select('.mcfi-close');

  const fileInput =
    select('.mcfi-file');

  const textArea =
    select('.mcfi-text');

  const startButton =
    select('.mcfi-go');

  const statusElement =
    select('.mcfi-status');

  const progressElement =
    select('.mcfi-progress');

  const logElement =
    select('.mcfi-log');

  closeButton.addEventListener(
    'click',
    () => {
      overlay.remove();
      style.remove();
    }
  );

  fileInput.addEventListener(
    'change',
    async () => {
      const file =
        fileInput.files?.[0];

      if (!file) {
        return;
      }

      textArea.value =
        await file.text();

      statusElement.textContent =
        `Loaded ${file.name}.`;
    }
  );

  startButton.addEventListener(
    'click',
    async () => {
      const playlistName =
        select(
          '.mcfi-name'
        ).value.trim();

      const requestedTracks =
        parseTrackInput(
          textArea.value
        );

      if (!playlistName) {
        statusElement.textContent =
          'Enter a playlist name.';

        return;
      }

      if (!requestedTracks.length) {
        statusElement.textContent =
          'No valid tracks were found.';

        return;
      }

      startButton.disabled = true;

      progressElement.max =
        requestedTracks.length;

      progressElement.value = 0;

      logElement.textContent = '';

      statusElement.textContent =
        `Searching for ${requestedTracks.length} tracks…`;

      let completedCount = 0;
      let matchedCount = 0;

      try {
        const results =
          await processWithConcurrency(
            requestedTracks,

            resolveTrack,

            (result) => {
              completedCount += 1;

              if (result.track) {
                matchedCount += 1;
              }

              progressElement.value =
                completedCount;

              statusElement.textContent =
                `${completedCount}/${requestedTracks.length} checked — ` +
                `${matchedCount} matched`;

              if (result.track) {
                const percentage =
                  Math.round(
                    result.score * 100
                  );

                logElement.textContent +=
                  `✓ ${result.requestedTrack.artists} — ` +
                  `${result.requestedTrack.title} ` +
                  `(${percentage}%, ${result.method})\n`;
              } else {
                logElement.textContent +=
                  `✗ ${result.requestedTrack.artists} — ` +
                  `${result.requestedTrack.title}: ` +
                  `${result.error}\n`;
              }

              logElement.scrollTop =
                logElement.scrollHeight;
            }
          );

        const matchedTracks =
          results
            .filter(
              (result) =>
                result?.track
            )
            .map(
              (result) =>
                result.track
            );

        if (!matchedTracks.length) {
          throw new Error(
            'No tracks matched, so no playlist was created.'
          );
        }

        const playlist =
          await savePlaylist(
            playlistName,
            matchedTracks
          );

        const failedCount =
          results.filter(
            (result) =>
              !result?.track
          ).length;

        statusElement.textContent =
          `Created “${playlist.name}” with ` +
          `${playlist.numberOfTracks} tracks. ` +
          `${failedCount} failed. Reload Monochrome to see the playlist.`;

        if (failedCount > 0) {
          downloadFailedTracks(
            results,
            playlistName
          );
        }

        console.table(
          results.map((result) => ({
            requested:
              `${result.requestedTrack.artists} - ` +
              result.requestedTrack.title,

            matched:
              result.track
                ? `${
                    result.track.artists
                      ?.map(
                        (artist) =>
                          artist.name
                      )
                      .join(', ') ||
                    result.track.artist
                      ?.name ||
                    ''
                  } - ${
                    result.track.title
                  }`
                : '',

            score:
              result.score
                ? Math.round(
                    result.score * 100
                  )
                : '',

            method:
              result.method || '',

            error:
              result.error || '',
          }))
        );
      } catch (error) {
        statusElement.textContent =
          `Import failed: ${
            error?.message ||
            String(error)
          }`;

        console.error(error);
      } finally {
        startButton.disabled = false;
      }
    }
  );

  console.log(
    'Fast Monochrome importer loaded.'
  );
})();