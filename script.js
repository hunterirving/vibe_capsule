const playPauseBtn = document.getElementById('playPause');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const playlist = document.getElementById('playlist');
const currentSongDisplay = document.getElementById('currentSong');
const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');
const audio = document.getElementById('audioPlayer');
audio.controls = true; // Enable controls for iOS media session

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
			updateCurrentSongDisplay(`Ready to play: ${songs[0].artist} – ${songs[0].title}`);
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
	const songText = `${song.artist} – ${song.title}`;

	// Always update display to ensure we remove "Ready to play:" prefix
	const currentText = currentSongDisplay.querySelector('span')?.textContent || '';

	// Check if it's a different song (not just play/pause of same song)
	const isNewSong = !currentText.includes(songText);
	const hasReadyToPlay = currentText.includes('Ready to play:');

	if (isNewSong || hasReadyToPlay) {
		updateCurrentSongDisplay(songText);
	} else {
		// Same song, just resume the marquee
		resumeMarquee();
	}

	// Update media session metadata
	if ('mediaSession' in navigator) {
		// Convert relative path to absolute URL for media session
		const albumArtUrl = new URL('resources/album_art.jpg', window.location.href).href;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: song.title,
			artist: song.artist,
			artwork: [
				{ src: albumArtUrl, sizes: '860x860', type: 'image/jpeg' },
				{ src: albumArtUrl, sizes: '512x512', type: 'image/jpeg' },
				{ src: albumArtUrl, sizes: '256x256', type: 'image/jpeg' },
				{ src: albumArtUrl, sizes: '128x128', type: 'image/jpeg' }
			]
		});

		// Set action handlers after playback starts (required for iOS)
		// Explicitly set seek handlers to null so iOS shows next/prev instead
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

		// Explicitly set seek handlers to null to show track controls instead
		navigator.mediaSession.setActionHandler('seekbackward', null);
		navigator.mediaSession.setActionHandler('seekforward', null);
	}
});

audio.addEventListener('pause', () => {
	stopProgressBar();
	pauseMarquee();
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
	// Initialize marquee effect after a brief delay to ensure DOM is updated
	setTimeout(() => setupMarquee(), 50);
}

// Marquee state
let marqueeAnimating = false;
let marqueePaused = false;
let marqueeTimeoutId = null;
let marqueeOriginalText = '';
let marqueeDuration = 0;
let marqueeHalfWidth = 0;
let marqueeTransitionEndHandler = null;
let marqueeCurrentTransform = 'translateX(0)';

function setupMarquee() {
	const container = currentSongDisplay;
	const textSpan = container.querySelector('span');

	if (!textSpan) return;

	// Clear any existing animation
	if (marqueeTimeoutId) {
		clearTimeout(marqueeTimeoutId);
		marqueeTimeoutId = null;
	}
	if (marqueeTransitionEndHandler) {
		textSpan.removeEventListener('transitionend', marqueeTransitionEndHandler);
		marqueeTransitionEndHandler = null;
	}
	marqueeAnimating = false;
	marqueePaused = false;

	// Reset styles
	textSpan.style.transition = 'none';
	textSpan.style.transform = 'translateX(0)';
	marqueeCurrentTransform = 'translateX(0)';
	container.classList.remove('no-overflow');

	// Store original text
	marqueeOriginalText = textSpan.textContent;

	// Force reflow
	void textSpan.offsetWidth;

	// Check if text overflows
	const containerWidth = container.offsetWidth - 30; // Account for padding
	const textWidth = textSpan.scrollWidth;
	const overflows = textWidth > containerWidth;

	if (!overflows) {
		// No overflow - show ellipsis behavior
		container.classList.add('no-overflow');
		container.classList.remove('marquee-active');
		return;
	}

	// Text overflows - setup marquee
	marqueeAnimating = true;
	container.classList.add('marquee-active');

	// Add spacing and duplicate text for seamless loop
	// Using non-breaking spaces (\u00A0) so they don't collapse in HTML
	const spacing = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'; // 12 non-breaking spaces
	textSpan.textContent = marqueeOriginalText + spacing + marqueeOriginalText + spacing;

	// Calculate animation parameters
	const fullWidth = textSpan.scrollWidth;
	marqueeHalfWidth = fullWidth / 2;
	marqueeDuration = (marqueeHalfWidth / 50) * 1000; // Adjust speed here (pixels per second)

	// Start animation after a brief delay (only if not paused)
	// Don't start animation if already paused
	if (!marqueePaused) {
		marqueeTimeoutId = setTimeout(() => {
			if (marqueePaused) return;

			textSpan.style.transition = `transform ${marqueeDuration}ms linear`;
			textSpan.style.transform = `translateX(-${marqueeHalfWidth}px)`;
			marqueeCurrentTransform = `translateX(-${marqueeHalfWidth}px)`;

			// Reset and loop
			marqueeTransitionEndHandler = () => {
				if (!marqueeAnimating || marqueePaused) return;

				textSpan.style.transition = 'none';
				textSpan.style.transform = 'translateX(0)';
				marqueeCurrentTransform = 'translateX(0)';

				setTimeout(() => {
					if (!marqueeAnimating || marqueePaused) return;
					textSpan.style.transition = `transform ${marqueeDuration}ms linear`;
					textSpan.style.transform = `translateX(-${marqueeHalfWidth}px)`;
					marqueeCurrentTransform = `translateX(-${marqueeHalfWidth}px)`;
				}, 50);
			};

			textSpan.addEventListener('transitionend', marqueeTransitionEndHandler);
		}, 1000); // Initial delay before starting scroll
	}
}

function pauseMarquee() {
	marqueePaused = true;
	const textSpan = currentSongDisplay.querySelector('span');
	if (!textSpan || !marqueeAnimating) return;

	// Capture current transform position
	const computedStyle = window.getComputedStyle(textSpan);
	const currentTransform = computedStyle.transform;
	marqueeCurrentTransform = currentTransform;

	// Freeze at current position
	textSpan.style.transition = 'none';
	textSpan.style.transform = currentTransform;

	// Clear any pending timeout
	if (marqueeTimeoutId) {
		clearTimeout(marqueeTimeoutId);
		marqueeTimeoutId = null;
	}
}

function resumeMarquee() {
	if (!marqueeAnimating) return;
	marqueePaused = false;

	const textSpan = currentSongDisplay.querySelector('span');
	if (!textSpan) return;

	// Apply the stored transform position first
	textSpan.style.transition = 'none';
	textSpan.style.transform = marqueeCurrentTransform;

	// Force reflow to apply the transform
	void textSpan.offsetWidth;

	// Get current position from the stored transform
	const matrix = new DOMMatrix(marqueeCurrentTransform);
	const currentX = matrix.m41;

	// Calculate remaining distance and time
	const distanceTraveled = Math.abs(currentX);
	const percentComplete = distanceTraveled / marqueeHalfWidth;
	const timeRemaining = marqueeDuration * (1 - percentComplete);

	// Resume animation from current position
	textSpan.style.transition = `transform ${timeRemaining}ms linear`;
	textSpan.style.transform = `translateX(-${marqueeHalfWidth}px)`;
	marqueeCurrentTransform = `translateX(-${marqueeHalfWidth}px)`;
}

// Add window resize listener to recalculate marquee
window.addEventListener('resize', () => {
	if (marqueeOriginalText) {
		// Store the paused state before recalculating
		const wasPaused = marqueePaused;

		// Restore original text before recalculating
		const textSpan = currentSongDisplay.querySelector('span');
		if (textSpan) {
			textSpan.textContent = marqueeOriginalText;
		}

		setupMarquee();

		// Restore paused state after recalculation
		if (wasPaused) {
			marqueePaused = true;
		}
	}
});

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
			// Now pause during seeking
			if (wasPlaying) {
				audio.pause();
			}
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

// Pre-caching system
function preloadResources() {
	console.log('Preloading UI resources...');

	const resources = [
		'resources/play.png',
		'resources/pause.png',
		'resources/prev.png',
		'resources/next.png',
		'resources/album_art.jpg'
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

	console.log(`Preloading: ${song.artist} – ${song.title}`);

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

			console.log(`✓ Fully preloaded: ${song.artist} – ${song.title}`);

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

	console.log(`🔥 Priority preloading: ${song.artist} – ${song.title}`);

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
