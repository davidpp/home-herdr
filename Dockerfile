# Copy release binaries, rather than compiling or adding a runtime distro.
ARG TAILSCALE_VERSION=v1.102.5
FROM tailscale/tailscale:${TAILSCALE_VERSION} AS source
RUN mkdir -p /proxy-state

FROM scratch
COPY --from=source /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY --from=source /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=source /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=source --chown=65532:65532 /proxy-state/ /state/
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/tailscaled"]
CMD ["--tun=userspace-networking", "--socks5-server=0.0.0.0:1055", "--socket=/run/tailscaled.sock", "--statedir=/state", "--state=/state/tailscaled.state"]
