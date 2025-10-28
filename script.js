const playPauseBtn = document.getElementById('playPause');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const playlist = document.getElementById('playlist');
const currentSongDisplay = document.getElementById('currentSong');
const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');
const audio = document.getElementById('audioPlayer');

let currentSongIndex = 0;
let isPlaying = false;
let progressInterval;
let playerReady = false;
let songs = [];
let animationFrameId = null;
let prePlaySeekTime = 0;
let preloadedAudio = {}; // Cache for preloaded audio elements
let currentPreloadIndex = 0;
let priorityPreloadQueue = []; // Songs requested by user that need priority preloading
let isPreloadingPriority = false;

// Load tracks from tracks.json
fetch('tracks.json')
	.then(response => {
		if (!response.ok) {
			throw new Error('tracks.json not found');
		}
		return response.json();
	})
	.then(data => {
		songs = data;
		if (songs.length > 0) {
			playerReady = true;
			updateCurrentSongDisplay(`Ready to play: ${songs[0].artist} - ${songs[0].title}`);
			renderPlaylist();
			// Pre-cache resources first, then songs
			preloadResources().then(() => {
				startPreloadingSongs();
			});
		} else {
			updateCurrentSongDisplay('No tracks found');
		}
	})
	.catch(error => {
		console.error('Error loading tracks:', error);
		updateCurrentSongDisplay('Error: tracks.json not found. Run scan.py first.');
	});

// Audio event listeners
audio.addEventListener('play', () => {
	startProgressBar();
	const song = songs[currentSongIndex];
	updateCurrentSongDisplay(song.looping ?
		`Looping: ${song.artist} - ${song.title}` :
		`Now playing: ${song.artist} - ${song.title}`);

	// Update media session metadata
	if ('mediaSession' in navigator) {
		navigator.mediaSession.metadata = new MediaMetadata({
			title: song.title,
			artist: song.artist
		});
	}
});

audio.addEventListener('pause', () => {
	stopProgressBar();
	// Only show "Paused" if the user actually paused (not during track transitions or seeking)
	if (!audio.ended && !isSeeking) {
		const song = songs[currentSongIndex];
		updateCurrentSongDisplay(`Paused: ${song.artist} - ${song.title}`);
	}
});

audio.addEventListener('ended', () => {
	if (songs[currentSongIndex].looping) {
		audio.currentTime = 0;
		audio.play();
	} else {
		nextSong();
	}
});

audio.addEventListener('error', (e) => {
	console.error('Audio error:', e);
	updateCurrentSongDisplay(`Error loading: ${songs[currentSongIndex].filename}`);
	// Try next song after a brief delay
	setTimeout(() => nextSong(), 1000);
});

audio.addEventListener('loadedmetadata', () => {
	resetProgressBar();
});

function renderPlaylist() {
	playlist.innerHTML = '';
	const currentDisplayText = currentSongDisplay.textContent;
	const isInitialized = currentDisplayText !== 'No song playing';

	songs.forEach((song, index) => {
		const item = document.createElement('div');
		item.classList.add('playlist-item');

		const contentDiv = document.createElement('div');
		contentDiv.classList.add('playlist-item-content');

		const titleDiv = document.createElement('div');
		titleDiv.classList.add('playlist-item-title');
		if (isInitialized && index === currentSongIndex) {
			titleDiv.classList.add('current');
		}
		titleDiv.textContent = song.title;

		const artistDiv = document.createElement('div');
		artistDiv.classList.add('playlist-item-artist');
		if (isInitialized && index === currentSongIndex) {
			artistDiv.classList.add('current');
		}
		artistDiv.textContent = song.artist;

		contentDiv.appendChild(titleDiv);
		contentDiv.appendChild(artistDiv);

		const loopIcon = document.createElement('span');
		loopIcon.textContent = '🔁';
		loopIcon.style.display = (song.looping || false) ? 'inline' : 'none';

		item.appendChild(contentDiv);
		item.appendChild(loopIcon);
		item.addEventListener('click', () => toggleLooping(index));
		playlist.appendChild(item);
	});
}

function toggleLooping(index) {
	if (!playerReady) return;
	if (index === currentSongIndex) {
		if (!isPlaying && currentSongDisplay.textContent.includes('Ready to play')) {
			audio.play();
			isPlaying = true;
			updatePlayPauseButton();
			return;
		}
		// Toggle looping
		songs[index].looping = !(songs[index].looping || false);
		renderPlaylist();

		const song = songs[index];
		// Update the display text based on current state
		if (isPlaying) {
			updateCurrentSongDisplay(song.looping ?
				`Looping: ${song.artist} - ${song.title}` :
				`Now playing: ${song.artist} - ${song.title}`);
		} else {
			updateCurrentSongDisplay(`Paused: ${song.artist} - ${song.title}`);
		}
	} else {
		playSong(index);
	}
}

function playSong(index) {
	if (!playerReady) return;
	// Clear looping from all songs except the new one if it was already looping
	const wasLooping = songs[index].looping || false;
	songs.forEach(song => song.looping = false);
	if (wasLooping) {
		songs[index].looping = true;
	}

	currentSongIndex = index;
	const song = songs[currentSongIndex];

	// Use preloaded blob if available, otherwise load from server
	if (preloadedAudio[song.filename]) {
		audio.src = preloadedAudio[song.filename].blobUrl;
	} else {
		audio.src = `tracks/${song.filename}`;
		// Request priority preloading for this song
		requestPriorityPreload(song.filename);
	}

	audio.play();
	isPlaying = true;
	updatePlayPauseButton();
	renderPlaylist();
}

function updateCurrentSongDisplay(text) {
	currentSongDisplay.innerHTML = `<span>${text}</span>`;
}

function togglePlayPause() {
	if (!playerReady) return;
	if (isPlaying) {
		audio.pause();
		isPlaying = false;
	} else {
		// If no song is loaded, load the first one
		if (!audio.src || audio.src === '') {
			playSong(currentSongIndex);
		} else {
			audio.play();
			isPlaying = true;
		}
	}
	updatePlayPauseButton();
}

function updatePlayPauseButton() {
	playPauseBtn.classList.toggle('pause', isPlaying);
}

function nextSong() {
	if (!playerReady) return;
	currentSongIndex = (currentSongIndex + 1) % songs.length;
	playSong(currentSongIndex);
}

function prevSong() {
	if (!playerReady) return;
	if (audio.currentTime <= 3) {
		currentSongIndex = (currentSongIndex - 1 + songs.length) % songs.length;
		playSong(currentSongIndex);
	} else {
		audio.currentTime = 0;
	}
}

function startProgressBar() {
	stopProgressBar();

	function animate() {
		updateProgressBar();
		animationFrameId = requestAnimationFrame(animate);
	}

	animate();
}

function stopProgressBar() {
	if (animationFrameId !== null) {
		cancelAnimationFrame(animationFrameId);
		animationFrameId = null;
	}
}

function resetProgressBar() {
	progressBar.style.setProperty('--progress', '0');
}

function updateProgressBar() {
	if (audio.duration && !isDragging && !isSeeking) {
		const currentTime = audio.currentTime;
		const duration = audio.duration;
		const progressPercentage = (currentTime / duration) * 100;
		const displayPercentage = isNaN(progressPercentage) ? 0 : progressPercentage;
		progressBar.style.setProperty('--progress', displayPercentage);
	}
}

let isDragging = false;
let wasPlayingBeforeDrag = false;
let pendingSeekPercentage = null;

function updateVisualProgress(event) {
	if (!playerReady) return;

	const rect = progressBar.getBoundingClientRect();
	// Support both mouse and touch events
	const clientX = event.touches ? event.touches[0].clientX : event.clientX;
	const clickPosition = clientX - rect.left;
	const clickPercentage = Math.max(0, Math.min(1, clickPosition / rect.width));

	progressBar.style.setProperty('--progress', clickPercentage * 100);
	return clickPercentage;
}

let isSeeking = false;
let targetSeekTime = null;

function applySeek(clickPercentage) {
	if (!playerReady) return;

	// If audio hasn't been loaded yet, load it but don't play
	if (!audio.src || audio.src === '') {
		const song = songs[currentSongIndex];

		// Use preloaded blob if available, otherwise load from server
		if (preloadedAudio[song.filename]) {
			audio.src = preloadedAudio[song.filename].blobUrl;
		} else {
			audio.src = `tracks/${song.filename}`;
		}

		// Wait for metadata to be loaded before seeking
		audio.addEventListener('loadedmetadata', function setInitialTime() {
			const duration = audio.duration;
			const seekTime = duration * clickPercentage;
			attemptSeekWithRetry(seekTime, clickPercentage);
			prePlaySeekTime = seekTime;
			audio.removeEventListener('loadedmetadata', setInitialTime);
		}, { once: true });
	} else if (audio.duration) {
		const duration = audio.duration;
		const seekTime = duration * clickPercentage;
		attemptSeekWithRetry(seekTime, clickPercentage);
		prePlaySeekTime = seekTime;
	}
}

function isTimeBuffered(time) {
	// Check if the given time is within any buffered time range
	for (let i = 0; i < audio.buffered.length; i++) {
		if (time >= audio.buffered.start(i) && time <= audio.buffered.end(i)) {
			return true;
		}
	}
	return false;
}

function attemptSeekWithRetry(seekTime, targetPercentage) {
	targetSeekTime = seekTime;
	isSeeking = true;

	// Lock the progress bar at the target position
	progressBar.style.setProperty('--progress', targetPercentage * 100);

	const wasPlaying = !audio.paused;

	// Try to seek
	audio.currentTime = seekTime;

	// Handler to check if we reached the target after seeking completes
	function checkSeekSuccess() {
		// Allow small tolerance for floating point comparison
		if (Math.abs(audio.currentTime - targetSeekTime) > 0.5) {
			// Browser clamped to buffered range - need to wait for more data
			// Now pause and show seeking status
			if (wasPlaying) {
				audio.pause();
			}
			const song = songs[currentSongIndex];
			updateCurrentSongDisplay(`Seeking: ${song.artist} - ${song.title}`);
			continueSeekingToTarget(wasPlaying);
		} else {
			// Successfully reached target immediately (was already buffered)
			isSeeking = false;
			targetSeekTime = null;
			// No need to update display - the seek was instant and playback continues normally
		}
	}

	audio.addEventListener('seeked', checkSeekSuccess, { once: true });
}

function continueSeekingToTarget(wasPlaying) {
	const song = songs[currentSongIndex];

	// Keep showing seeking status
	updateCurrentSongDisplay(`Seeking: ${song.artist} - ${song.title}`);

	// Handler for when more data loads
	function retrySeek() {
		if (!isSeeking || targetSeekTime === null) {
			return; // Seeking was cancelled
		}

		audio.currentTime = targetSeekTime;

		// Check again after this seek completes
		function checkAgain() {
			if (!isSeeking || targetSeekTime === null) {
				return;
			}

			if (Math.abs(audio.currentTime - targetSeekTime) > 0.5) {
				// Still not there, keep trying
				continueSeekingToTarget(wasPlaying);
			} else {
				// Success!
				isSeeking = false;
				targetSeekTime = null;

				if (wasPlaying) {
					audio.play();
				} else {
					updateCurrentSongDisplay(`Paused: ${song.artist} - ${song.title}`);
				}
			}
		}

		audio.addEventListener('seeked', checkAgain, { once: true });
	}

	// Wait for more data to load, then try again
	audio.addEventListener('progress', retrySeek, { once: true });

	// Also set a timeout fallback in case progress doesn't fire
	setTimeout(() => {
		if (isSeeking && targetSeekTime !== null && Math.abs(audio.currentTime - targetSeekTime) > 0.5) {
			retrySeek();
		}
	}, 1000);
}

function onProgressMouseDown(event) {
	if (!playerReady) return;
	isDragging = true;
	wasPlayingBeforeDrag = isPlaying;
	progressContainer.style.cursor = 'grabbing';
	document.body.style.cursor = 'grabbing';
	pendingSeekPercentage = updateVisualProgress(event);
	event.preventDefault();
}

function onProgressMouseMove(event) {
	if (isDragging) {
		pendingSeekPercentage = updateVisualProgress(event);
	}
}

function onProgressMouseUp(event) {
	if (isDragging) {
		isDragging = false;
		progressContainer.style.cursor = '';
		document.body.style.cursor = '';

		// Apply the seek now that drag is complete
		if (pendingSeekPercentage !== null) {
			applySeek(pendingSeekPercentage);
			pendingSeekPercentage = null;
		}

		// If it was "Ready to play" (not playing before), start playing now
		if (!wasPlayingBeforeDrag && !isPlaying && audio.src) {
			audio.play();
			isPlaying = true;
			updatePlayPauseButton();
		}
	}
}

playPauseBtn.addEventListener('click', togglePlayPause);
nextBtn.addEventListener('click', nextSong);
prevBtn.addEventListener('click', prevSong);

// Mouse events for desktop
progressContainer.addEventListener('mousedown', onProgressMouseDown);
document.addEventListener('mousemove', onProgressMouseMove);
document.addEventListener('mouseup', onProgressMouseUp);

// Touch events for mobile
progressContainer.addEventListener('touchstart', onProgressMouseDown, { passive: false });
document.addEventListener('touchmove', onProgressMouseMove, { passive: false });
document.addEventListener('touchend', onProgressMouseUp);

// Keyboard controls
document.addEventListener('keydown', function(event) {
	if (!playerReady) return;

	// Spacebar: play/pause
	if (event.code === 'Space') {
		event.preventDefault();
		togglePlayPause();
	}
});

// Media key controls
navigator.mediaSession.metadata = new MediaMetadata({
	title: 'vibe capsule',
	artist: 'MP3 Player'
});

navigator.mediaSession.setActionHandler('play', () => {
	if (playerReady && !isPlaying) {
		togglePlayPause();
	}
});

navigator.mediaSession.setActionHandler('pause', () => {
	if (playerReady && isPlaying) {
		togglePlayPause();
	}
});

navigator.mediaSession.setActionHandler('previoustrack', () => {
	if (playerReady) {
		prevSong();
	}
});

navigator.mediaSession.setActionHandler('nexttrack', () => {
	if (playerReady) {
		nextSong();
	}
});

// Pre-caching system
function preloadResources() {
	console.log('Preloading UI resources...');

	const resources = [
		'resources/play.png',
		'resources/pause.png',
		'resources/prev.png',
		'resources/next.png'
	];

	const imagePromises = resources.map(src => {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				console.log(`Preloaded: ${src}`);
				resolve();
			};
			img.onerror = () => {
				console.error(`Failed to preload: ${src}`);
				resolve(); // Resolve anyway to not block other resources
			};
			img.src = src;
		});
	});

	return Promise.all(imagePromises).then(() => {
		console.log('All UI resources preloaded');
	});
}

function startPreloadingSongs() {
	// Start with the first song
	currentPreloadIndex = 0;
	preloadNextSong();
}

function preloadNextSong() {
	if (currentPreloadIndex >= songs.length) {
		console.log('All songs preloaded');
		return;
	}

	const song = songs[currentPreloadIndex];
	const filename = song.filename;

	// Skip if already preloaded
	if (preloadedAudio[filename]) {
		currentPreloadIndex++;
		preloadNextSong();
		return;
	}

	console.log(`Preloading: ${song.artist} - ${song.title}`);

	// Use fetch to force full download of the entire file
	fetch(`tracks/${filename}`)
		.then(response => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			// Get total file size for progress tracking
			const contentLength = response.headers.get('content-length');
			console.log(`Downloading ${song.title} (${(contentLength / 1024 / 1024).toFixed(2)} MB)...`);

			// Read the entire response as a blob
			return response.blob();
		})
		.then(blob => {
			// Create a blob URL that will persist in memory
			const blobUrl = URL.createObjectURL(blob);

			// Create audio element with the fully downloaded blob
			const preloadAudio = new Audio();
			preloadAudio.preload = 'auto';
			preloadAudio.src = blobUrl;

			// Wait for the audio element to fully buffer the blob
			return new Promise((resolve) => {
				const checkBuffered = () => {
					// Check if the entire duration is buffered
					if (preloadAudio.duration > 0 && preloadAudio.buffered.length > 0) {
						const bufferedEnd = preloadAudio.buffered.end(preloadAudio.buffered.length - 1);
						if (bufferedEnd >= preloadAudio.duration - 0.1) {
							// Fully buffered!
							resolve({ preloadAudio, blobUrl, blob });
							return;
						}
					}
					// Not fully buffered yet, check again soon
					setTimeout(checkBuffered, 100);
				};

				// Start checking once metadata is loaded
				preloadAudio.addEventListener('loadedmetadata', () => {
					checkBuffered();
				}, { once: true });

				// Trigger the loading
				preloadAudio.load();
			});
		})
		.then(({ preloadAudio, blobUrl, blob }) => {
			// Store both the audio element and blob URL
			preloadedAudio[filename] = {
				audio: preloadAudio,
				blobUrl: blobUrl,
				blob: blob
			};

			console.log(`✓ Fully preloaded: ${song.artist} - ${song.title}`);

			// Move to next song
			currentPreloadIndex++;
			setTimeout(() => preloadNextSong(), 100);
		})
		.catch(error => {
			console.error(`Failed to preload ${filename}:`, error);
			currentPreloadIndex++;
			preloadNextSong();
		});
}

// Priority preloading system
function requestPriorityPreload(filename) {
	// Skip if already preloaded or already in priority queue
	if (preloadedAudio[filename] || priorityPreloadQueue.includes(filename)) {
		return;
	}

	console.log(`🔥 Priority preload requested: ${filename}`);
	priorityPreloadQueue.push(filename);

	// Start priority preloading if not already running
	if (!isPreloadingPriority) {
		processPriorityPreload();
	}
}

function processPriorityPreload() {
	if (priorityPreloadQueue.length === 0) {
		isPreloadingPriority = false;
		return;
	}

	isPreloadingPriority = true;
	const filename = priorityPreloadQueue.shift();

	// Check if already preloaded (might have finished during normal preloading)
	if (preloadedAudio[filename]) {
		processPriorityPreload();
		return;
	}

	// Find the song info
	const song = songs.find(s => s.filename === filename);
	if (!song) {
		processPriorityPreload();
		return;
	}

	console.log(`🔥 Priority preloading: ${song.artist} - ${song.title}`);

	// Use fetch to force full download of the entire file
	fetch(`tracks/${filename}`)
		.then(response => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			return response.blob();
		})
		.then(blob => {
			// Create a blob URL that will persist in memory
			const blobUrl = URL.createObjectURL(blob);

			// Create audio element with the fully downloaded blob
			const preloadAudio = new Audio();
			preloadAudio.preload = 'auto';
			preloadAudio.src = blobUrl;

			// Wait for the audio element to fully buffer the blob
			return new Promise((resolve) => {
				const checkBuffered = () => {
					// Check if the entire duration is buffered
					if (preloadAudio.duration > 0 && preloadAudio.buffered.length > 0) {
						const bufferedEnd = preloadAudio.buffered.end(preloadAudio.buffered.length - 1);
						if (bufferedEnd >= preloadAudio.duration - 0.1) {
							// Fully buffered!
							resolve({ preloadAudio, blobUrl, blob });
							return;
						}
					}
					// Not fully buffered yet, check again soon
					setTimeout(checkBuffered, 100);
				};

				// Start checking once metadata is loaded
				preloadAudio.addEventListener('loadedmetadata', () => {
					checkBuffered();
				}, { once: true });

				// Trigger the loading
				preloadAudio.load();
			});
		})
		.then(({ preloadAudio, blobUrl, blob }) => {
			// Store both the audio element and blob URL
			preloadedAudio[filename] = {
				audio: preloadAudio,
				blobUrl: blobUrl,
				blob: blob
			};

			// Switch to the preloaded version if this is the current song
			if (songs[currentSongIndex].filename === filename && audio.src !== blobUrl) {
				const currentTime = audio.currentTime;
				const wasPlaying = !audio.paused;
				audio.src = blobUrl;
				audio.currentTime = currentTime;
				if (wasPlaying) {
					audio.play().catch(err => {
						// Ignore play interruption errors (expected during source switching)
						if (err.name !== 'AbortError') {
							console.error('Error resuming playback:', err);
						}
					});
				}
			}

			// Process next priority request
			processPriorityPreload();
		})
		.catch(error => {
			// Ignore abort errors (happens when normal preload finishes first)
			if (error.name === 'AbortError' || error.message.includes('aborted')) {
				// This is expected - normal preloading probably finished first
			} else {
				console.error(`Failed to priority preload ${filename}:`, error);
			}
			processPriorityPreload();
		});
}
