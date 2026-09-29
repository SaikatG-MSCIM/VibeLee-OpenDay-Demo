# VibeLee

**VibeLee** is a mobile-first, location-aware web application for discovering events and visitor experiences in Cork. It was developed as part of the **CS6200 MSc Project** at University College Cork.

The application brings event discovery, map-based browsing, nearby events, tourist-oriented routing, and a constrained random **Surprise Me** mode into one interface.

## Submitted Project Build

This submission uses the **Open Day demonstration build** of VibeLee.

At the time the project materials were prepared, the live CorkGigs website was unavailable. To ensure that the project can still be reproduced and evaluated consistently, the submitted build uses a locally stored archived CorkGigs HTML snapshot located at:

`demo-data/corkgigs-2026-05-13.html`

The archive wrapper is implemented in `archive-demo.cjs`. It supplies the archived CorkGigs listing to the existing parser and prevents the application from waiting on unavailable live CorkGigs pages. The rest of the VibeLee application logic, including filtering, map interaction, venue data, Tourist Mode, Surprise Me, routing, and interface behaviour, remains part of the submitted implementation.

Because the source data is an archived snapshot, the displayed events correspond to the archived dataset rather than current live listings.

## Main Features

- Event discovery with date, category, search, and geographic-scope filters
- Interactive MapLibre map with venue markers
- Browser geolocation / **Near Me** functionality
- Event detail pages and external booking links where available
- **Tourist Mode** combining curated Cork locations, walking routes, and an event destination
- **Surprise Me** mode for constrained random event selection
- Mobile-first responsive interface
- Venue coordinate cache and manual venue overrides
- Optional Eventbrite enrichment when an Eventbrite API token is supplied

## Technology Used

- Node.js
- Express
- EJS
- Axios
- Cheerio
- MapLibre GL JS
- OpenFreeMap
- OpenStreetMap / Nominatim
- OSRM walking-route service
- Eventbrite API (optional enrichment)
- Browser Geolocation API and Local Storage

## Project Structure

```text
VibeLee-OpenDay-Demo/
├── archive-demo.cjs                  # Entry point for the submitted demo build
├── server.js                         # Main Express application and application logic
├── package.json
├── package-lock.json
├── .gitignore
│
├── demo-data/
│   └── corkgigs-2026-05-13.html     # Archived CorkGigs listing used by this build
│
├── data/
│   ├── event-category-overrides.json
│   ├── tourist-places.json
│   └── venue-cache-seed.json
│
├── venue-cache.json                  # Cached venue/geographic information
├── venue-overrides.json              # Manual venue coordinate corrections
│
├── public/
│   ├── app.js
│   ├── detail.js
│   ├── tourist.js
│   ├── surprise.js
│   ├── onboarding.js
│   ├── style.css
│   ├── full-map.css
│   └── icons/
│
└── views/
    ├── index.ejs
    ├── event-details.ejs
    ├── tourist.ejs
    └── surprise.ejs
```

## Requirements

Use a recent Node.js installation. **Node.js 20.18.1 or newer is required.**

You will also need:

- npm
- a modern web browser with JavaScript enabled
- an internet connection for map tiles, routing, geolocation-related services, and external provider links

The core archived CorkGigs event listing itself is included in the project and does not require the live CorkGigs website.

## Installation and Setup

### 1. Extract or clone the project

If working from the submitted ZIP archive, extract it to a local folder.

If using Git:

```bash
git clone https://github.com/SaikatG-MSCIM/VibeLee-OpenDay-Demo.git
cd VibeLee-OpenDay-Demo
```

### 2. Install dependencies

From the project directory, run:

```bash
npm ci
```

`npm ci` is recommended because the included `package-lock.json` installs the dependency versions recorded for the submitted project.

If necessary, `npm install` can also be used.

### 3. Environment configuration

The application can run without an Eventbrite token. Eventbrite enrichment is optional.

To enable Eventbrite enrichment, create a `.env` file in the project root:

```env
EVENTBRITE_TOKEN=YOUR_EVENTBRITE_PRIVATE_TOKEN
```

Do **not** commit or distribute a private Eventbrite token.

The application will use port `3001` locally unless a `PORT` environment variable is supplied.

### 4. Start the application

Run:

```bash
npm start
```

The submitted `package.json` starts:

```text
node archive-demo.cjs
```

This is intentional. Examiners should use `npm start` rather than starting `server.js` directly, because `archive-demo.cjs` provides the reproducible archived CorkGigs data source used for this submission.

A successful startup should include output similar to:

```text
[VibeLee archive demo] Using CorkGigs snapshot from 13 May 2026 ...
CorkGigs MapLibre app running at http://localhost:3001
```

### 5. Open VibeLee

In a browser, open:

```text
http://localhost:3001
```

## Suggested Evaluation Routes

After starting the application, the following areas demonstrate the main functionality:

```text
/             Discover page
/tourist      Tourist Mode
/surprise     Surprise Me
```

From the Discover page, select any event card to access its event detail page.

Recommended checks:

1. Search for an event or venue.
2. Change the date or category filters.
3. Open the interactive map and select a venue marker.
4. Allow browser location access and test the Near Me behaviour.
5. Open an event detail page.
6. Open Tourist Mode and generate a route.
7. Open Surprise Me and draw an event using different constraints.

## Eventbrite Token

`EVENTBRITE_TOKEN` is optional.

If no token is configured:

- VibeLee still starts normally.
- Core event discovery, filtering, maps, Tourist Mode, and Surprise Me remain available.
- Eventbrite-specific enrichment and Eventbrite diagnostic endpoints are unavailable.

If a valid token is supplied, the application can attempt to enrich matching events using the Eventbrite API.

## External Services and Network Access

Although the archived CorkGigs source is stored locally, some functions use external web services:

- **MapLibre GL JS** is loaded in the browser.
- **OpenFreeMap** supplies the map style and tiles.
- **Nominatim / OpenStreetMap** may be used for geocoding when required.
- **OSRM** is used for Tourist Mode walking routes.
- **Eventbrite** may be used when an API token is configured.
- Event and ticket buttons may open third-party websites.

If an external service is unavailable, the corresponding network-dependent feature may be limited while the remainder of the application continues to run.

## Venue Data

VibeLee includes local venue information to reduce dependence on repeated live geocoding:

- `venue-cache.json` contains cached venue results.
- `data/venue-cache-seed.json` contains seed venue data.
- `venue-overrides.json` contains manually corrected venue coordinates.

These files are intentionally included in the submitted materials and should not be removed before evaluation.

## Browser State / Onboarding

VibeLee stores some interface preferences in browser Local Storage, including onboarding and map UI state.

To view the first-time onboarding experience again, either:

- clear site data / Local Storage for `localhost:3001`, or
- open the application in a private/incognito browser window.

## Optional Render Deployment

The submitted project can also be deployed as a Node.js web service.

Example Render configuration:

```text
Build Command: npm install
Start Command: npm start
```

Do not manually define `PORT` on Render; the application reads the platform-provided `PORT` value.

Current demonstration deployment:

https://vibelee-openday-demo.onrender.com/

## Important Reproduction Note

The archived CorkGigs snapshot is included specifically to make this submitted build reproducible while the original upstream website is unavailable. No live CorkGigs connection is required when running the submitted build through `npm start`.

The file `server.js` retains the main VibeLee implementation, while `archive-demo.cjs` acts as a small submission/demo wrapper around that implementation.

## Author

**Saikat Ganguly**  
MSc Interactive Media  
University College Cork  
CS6200 MSc Project

