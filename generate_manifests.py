#!/usr/bin/env python3
"""
Creates manifest.json, resource-manifest.json, and service-worker.js
based on the contents of tracks.json
"""

import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.absolute()
TRACKS_JSON = SCRIPT_DIR / "tracks.json"


def generate_pwa_manifests():
	"""Generate PWA manifest files based on tracks.json"""
	print("Generating PWA manifests...")

	# Load tracks.json
	if not TRACKS_JSON.exists():
		print("Error: tracks.json not found. Run scan.py first.")
		return

	with open(TRACKS_JSON, 'r', encoding='utf-8') as f:
		tracks = json.load(f)

	# Generate manifest.json
	manifest = {
		"id": "/vibe_capsule/",
		"name": "vibe capsule",
		"short_name": "vibe capsule",
		"description": "mixtape as artifact",
		"start_url": "/vibe_capsule/",
		"scope": "/vibe_capsule/",
		"display": "standalone",
		"background_color": "#1a1a1a",
		"theme_color": "#1a1a1a",
		"icons": [
			{
				"src": "resources/icon.png",
				"sizes": "640x640",
				"type": "image/png",
				"purpose": "any maskable"
			}
		]
	}

	with open(SCRIPT_DIR / "manifest.json", 'w', encoding='utf-8') as f:
		json.dump(manifest, f, indent=2)
	print("✓ Generated manifest.json")

	# Generate resource-manifest.json
	resource_manifest = {
		"static_files": [
			"./",
			"index.html",
			"styles.css",
			"script.js",
			"tracks.json",
			"resources/icon.png",
			"resources/play.png",
			"resources/pause.png",
			"resources/prev.png",
			"resources/next.png",
			"resources/album_art.jpg"
		],
		"tracks": [f"tracks/{track['filename']}" for track in tracks]
	}

	with open(SCRIPT_DIR / "resource-manifest.json", 'w', encoding='utf-8') as f:
		json.dump(resource_manifest, f, indent=2)
	print("✓ Generated resource-manifest.json")

	# Generate service-worker.js
	all_files = resource_manifest["static_files"] + resource_manifest["tracks"]
	service_worker_content = f'''// Auto-generated service worker for vibe capsule PWA
const CACHE_NAME = 'vibe-capsule-v3';
const urlsToCache = {json.dumps(all_files, indent=2)};

// Get the base path from the service worker location
const getBasePath = () => {{
	const swPath = self.location.pathname;
	return swPath.substring(0, swPath.lastIndexOf('/') + 1);
}};

const basePath = getBasePath();

// Install event - cache all resources
self.addEventListener('install', (event) => {{
	console.log('Service Worker installing...', 'Base path:', basePath);
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => {{
				console.log('Opened cache');
				// Make URLs absolute relative to service worker location
				const absoluteUrls = urlsToCache.map(url => {{
					if (url === './') return basePath;
					return new URL(url, basePath + 'index.html').href;
				}});
				console.log('Caching', absoluteUrls.length, 'resources');
				console.log('URLs to cache:', absoluteUrls);

				// Cache files one by one with better error handling
				return Promise.all(
					absoluteUrls.map(url =>
						cache.add(url)
							.then(() => console.log('✓ Cached:', url))
							.catch(err => console.error('✗ Failed to cache:', url, err))
					)
				);
			}})
			.then(() => {{
				console.log('All resources cached successfully');
				return self.skipWaiting();
			}})
			.catch(error => {{
				console.error('Service Worker installation failed:', error);
			}})
	);
}});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {{
	console.log('Service Worker activating...');
	event.waitUntil(
		caches.keys().then((cacheNames) => {{
			return Promise.all(
				cacheNames.map((cacheName) => {{
					if (cacheName !== CACHE_NAME) {{
						console.log('Deleting old cache:', cacheName);
						return caches.delete(cacheName);
					}}
				}})
			);
		}}).then(() => self.clients.claim())
	);
}});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {{
	event.respondWith(
		caches.match(event.request)
			.then((response) => {{
				// Cache hit - return response
				if (response) {{
					console.log('Serving from cache:', event.request.url);
					return response;
				}}

				// Cache miss - try network
				console.log('Fetching from network:', event.request.url);
				return fetch(event.request).then((response) => {{
					// Check if valid response
					if (!response || response.status !== 200) {{
						return response;
					}}

					// Clone the response for caching
					const responseToCache = response.clone();

					caches.open(CACHE_NAME)
						.then((cache) => {{
							cache.put(event.request, responseToCache);
						}});

					return response;
				}}).catch((error) => {{
					console.error('Fetch failed; returning offline page if available:', error);
					// If fetch fails, try to return from cache one more time
					return caches.match(event.request);
				}});
			}})
	);
}});
'''

	with open(SCRIPT_DIR / "service-worker.js", 'w', encoding='utf-8') as f:
		f.write(service_worker_content)
	print("✓ Generated service-worker.js")
	print()
	print("PWA manifests generated successfully!")


if __name__ == "__main__":
	generate_pwa_manifests()
