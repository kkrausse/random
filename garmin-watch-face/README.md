# Simple Analog Garmin Watch Face

A minimal three-hand analog face inspired by the Casio MQ-24, targeting the Garmin Forerunner 165.

## Requirements

- Garmin Connect IQ SDK 9.2.0 and the `fr165` device definition, installed with SDK Manager
- Java 21
- `libmtp` for installing over USB on macOS (`brew install libmtp`)

Create a developer signing key once from the project directory:

```sh
openssl genrsa -out developer_key.pem 4096
openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
```

Both key files are intentionally ignored by Git. Back them up securely if you want future builds to update the same installed app.

## Build

```sh
./build.sh
```

## Run in Garmin's simulator

```sh
./run-simulator.sh
```

## Install on the watch

1. Connect the Forerunner 165 by USB and leave it on its normal charging screen.
2. Build and transfer the face:

```sh
./install.sh
```

3. Wait for the transfer to reach 100%, then unplug the watch.
4. From the normal watch face, hold **UP**, select **Watch Face**, choose **Simple Analog**, and select **Apply**.

The `UNKNOWN in libmtp` warning is expected for Garmin's USB product ID and is harmless when the device is subsequently identified as `Forerunner 165`.

If the watch appears as USB product `0x0003` instead of `0x5150`, unplug it, wait a few seconds, and reconnect it before retrying. Product `0x5150` is the normal MTP file-transfer mode.
