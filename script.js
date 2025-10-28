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
	const song = songs[currentSongIndex];
	updateCurrentSongDisplay(`Paused: ${song.artist} - ${song.title}`);
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
	audio.src = `tracks/${song.filename}`;
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
	progressBar.style.setProperty('--progress', '0%');
}

function updateProgressBar() {
	if (audio.duration && !isDragging) {
		const currentTime = audio.currentTime;
		const duration = audio.duration;
		const progressPercentage = (currentTime / duration) * 100;
		const displayPercentage = isNaN(progressPercentage) ? 0 : progressPercentage;

		progressBar.style.setProperty('--progress', `${displayPercentage}%`);
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

	progressBar.style.setProperty('--progress', `${clickPercentage * 100}%`);
	return clickPercentage;
}

function applySeek(clickPercentage) {
	if (!playerReady) return;

	// If audio hasn't been loaded yet, load it but don't play
	if (!audio.src || audio.src === '') {
		const song = songs[currentSongIndex];
		audio.src = `tracks/${song.filename}`;

		// Wait for metadata to be loaded before seeking
		audio.addEventListener('loadedmetadata', function setInitialTime() {
			const duration = audio.duration;
			const seekTime = duration * clickPercentage;
			audio.currentTime = seekTime;
			prePlaySeekTime = seekTime;
			audio.removeEventListener('loadedmetadata', setInitialTime);
		}, { once: true });
	} else if (audio.duration) {
		const duration = audio.duration;
		const seekTime = duration * clickPercentage;
		audio.currentTime = seekTime;
		prePlaySeekTime = seekTime;
	}
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
