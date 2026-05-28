from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class CachelessHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8000), CachelessHandler)
    print("Serving Sun Shade Map at http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()