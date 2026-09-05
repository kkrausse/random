#!/bin/sh
set -xeu -o pipefail
trap 'poweroff -f' EXIT

ip link set dev eth0 up
udhcpc -i eth0

mkdir /mnt/sdb
mount /dev/sdb /mnt/sdb
mkdir /mnt/sdb/boot
mount /dev/sda /mnt/sdb/boot

setup-apkrepos -1
echo 'http://dl-cdn.alpinelinux.org/alpine/v3.21/community' >> /etc/apk/repositories
BOOTLOADER=none setup-disk -m sys /mnt/sdb/
cp /mnt/sdb/boot/vmlinuz-virt /mnt/sdc1/
KERNEL_VERSION=$(ls /mnt/sdb/lib/modules | head -n 1 | tr -d '\n')

echo 'rc_sys="docker"' >> /mnt/sdb/etc/rc.conf
cat > /mnt/sdb/etc/network/interfaces <<'EOF'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

chroot /mnt/sdb apk add --no-progress --no-cache ca-certificates $(cat /mnt/sdc1/packages)
chroot /mnt/sdb update-ca-certificates

unzip /mnt/sdc1/bun.zip -d /tmp/bun
install -m 755 /tmp/bun/bun-linux-x64-musl-baseline/bun /mnt/sdb/usr/local/bin/bun
cp -a /mnt/sdc1/workspace /mnt/sdb/workspace
cp /etc/resolv.conf /mnt/sdb/etc/resolv.conf

OPENCODE_VERSION=$(cat /mnt/sdc1/opencode-version)
chroot /mnt/sdb /bin/sh -lc "bun install --global --trust @opencode-ai/cli@${OPENCODE_VERSION}"
ln -s /root/.bun/bin/opencode2 /mnt/sdb/usr/local/bin/opencode2
chroot /mnt/sdb /bin/sh -lc 'cd /workspace && bun install --frozen-lockfile'
chroot /mnt/sdb /bin/sh -lc 'bun --version && opencode2 --version && cd /workspace && bun run build'

cp /mnt/sdc1/setup-wasm-networking /mnt/sdb/etc/init.d/
chmod 755 /mnt/sdb/etc/init.d/setup-wasm-networking
mkdir /mnt/sdb/etc/runlevels/additional
cat <<'EOF' >> /mnt/sdb/etc/inittab
# Additional initialization
::once:/sbin/openrc additional &> /dev/null
EOF
chroot /mnt/sdb rc-update add setup-wasm-networking additional
cp /mnt/sdc1/root-profile /mnt/sdb/root/.profile
chmod 644 /mnt/sdb/root/.profile

apk add --no-progress --no-cache mkinitfs
cp /mnt/sdc1/init.sh /mnt/sdb/sbin/init.sh
chmod 755 /mnt/sdb/sbin/init.sh
mkinitfs -i /mnt/sdb/sbin/init.sh -c /etc/mkinitfs/mkinitfs.conf -b /mnt/sdb/ "$KERNEL_VERSION"
mv /mnt/sdb/boot/initramfs-virt /mnt/sdc1/

umount /mnt/sdb/boot
trap - EXIT
