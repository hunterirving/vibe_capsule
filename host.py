#!/usr/bin/env python3
"""
Simple HTTP Server for vibe capsule MP3 player
Starts server and opens browser automatically
"""

import http.server
import socketserver
import webbrowser
import socket
import sys
from pathlib import Path

DEFAULT_PORT = 8000


def get_local_ip():
	"""Get the local IP address for network access"""
	try:
		# Create a socket to determine the local IP
		s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		# Connect to a public DNS server (doesn't actually send data)
		s.connect(("8.8.8.8", 80))
		local_ip = s.getsockname()[0]
		s.close()
		return local_ip
	except Exception:
		return "Unable to determine"


def find_available_port(start_port=DEFAULT_PORT, max_attempts=10):
	"""Find an available port starting from start_port"""
	for port in range(start_port, start_port + max_attempts):
		try:
			with socketserver.TCPServer(("", port), None) as s:
				return port
		except OSError:
			continue
	return None


def main():
	# Change to script directory
	script_dir = Path(__file__).parent.absolute()
	os.chdir(script_dir)

	# Find an available port
	port = find_available_port(DEFAULT_PORT)

	if port is None:
		print(f"Error: Could not find an available port (tried {DEFAULT_PORT}-{DEFAULT_PORT + 9})")
		sys.exit(1)

	# Get local IP for network access
	local_ip = get_local_ip()

	# Create server
	Handler = http.server.SimpleHTTPRequestHandler

	# Suppress default logging
	class QuietHandler(Handler):
		def log_message(self, format, *args):
			pass

	try:
		with socketserver.TCPServer(("", port), QuietHandler) as httpd:
			local_url = f"http://localhost:{port}"
			network_url = f"http://{local_ip}:{port}"

			print("=" * 60)
			print("💿 vibe capsule")
			print("=" * 60)
			print(f"\nServer running on port {port}")
			print(f"\nLocal access:   {local_url}")
			print(f"Network access: {network_url}")
			print("\nPress Ctrl+C to stop the server")
			print("=" * 60)

			# Open browser
			webbrowser.open(local_url)

			# Serve forever
			httpd.serve_forever()

	except KeyboardInterrupt:
		print("\n\nShutting down server...")
		sys.exit(0)
	except Exception as e:
		print(f"\nError starting server: {e}")
		sys.exit(1)


if __name__ == "__main__":
	import os
	main()
