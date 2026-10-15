`player.mp4` is a synthetic, silent 20-second color-frame video generated for
HomeTV playback/layout tests. It contains no third-party footage. The integration
harness serves it over a loopback HTTP endpoint with byte-range support.

`hls/` is a 6-second HLS remux of the same synthetic video (ffmpeg -c copy -t 6 -hls_time 2 -hls_playlist_type vod), used to test iOS offline packages without external media.
