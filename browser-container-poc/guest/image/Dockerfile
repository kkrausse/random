ARG PACKAGES="bash curl git libstdc++ ripgrep unzip"
ARG ALPINE_VERSION=3.21.2
ARG BUN_VERSION=1.4.2

FROM golang AS create-image-dev
COPY ./create-image ./create-image
RUN cd create-image && go build -o /out/create-image .

FROM ubuntu:24.04 AS image-dev-x86_64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates qemu-system-x86 qemu-utils wget && rm -rf /var/lib/apt/lists/*

ARG PACKAGES
RUN mkdir /out /share
COPY ./alpine.iso /out/
COPY ./bun.zip /share/
COPY ./opencode.tgz /share/
RUN dd if=/dev/zero of=/out/tmp.img bs=80M count=1 && mkfs.ext4 /out/tmp.img && \
    dd if=/dev/zero of=/out/disk-rootfs.img bs=768M count=1 && mkfs.ext4 -O ^has_journal /out/disk-rootfs.img

COPY ./init.sh ./create-image.sh ./setup-wasm-networking ./root-profile /share/
COPY ./workspace /share/workspace
COPY --from=create-image-dev /out/create-image /create-image
COPY ./create-image-args-x86_64.json .
RUN printf '%s' "$PACKAGES" > /share/packages && \
    /create-image --args-json=create-image-args-x86_64.json qemu-system-x86_64
RUN rm -f /tmp/guest-build-ok && \
    debugfs -R 'dump /guest-build-ok /tmp/guest-build-ok' /out/disk-rootfs.img && \
    test -s /tmp/guest-build-ok && \
    debugfs -R 'dump /initramfs-virt /share/initramfs-virt' /out/tmp.img && \
    test -s /share/initramfs-virt

FROM scratch
COPY --from=image-dev-x86_64 /out/disk-rootfs.img /
COPY --from=image-dev-x86_64 /share/vmlinuz-virt /
COPY --from=image-dev-x86_64 /share/initramfs-virt /
