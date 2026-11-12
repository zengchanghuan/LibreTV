`player.mp4` is a synthetic, silent 20-second color-frame video generated for
HomeTV playback/layout tests. It contains no third-party footage. The integration
harness serves it over a loopback HTTP endpoint with byte-range support.

`hls/` is a 6-second HLS remux of the same synthetic video (ffmpeg -c copy -t 6 -hls_time 2 -hls_playlist_type vod), used to test iOS offline packages without external media.

`background.mp4` is a 60-second loop of the synthetic color video with a quiet
440 Hz AAC test tone (amplitude scaled to 0.015). Unlike the silent fixture, it
contains a real audio track for background-audio and PiP integration checks.
Generated with ffmpeg: `-stream_loop 2 -i player.mp4 -f lavfi -i
sine=frequency=440:sample_rate=48000:duration=60 -filter:a volume=0.015
-c:v copy -c:a aac -b:a 48k -t 60 -movflags +faststart background.mp4`.
