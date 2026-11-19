"""Process one upload using anonymous Linux memory files and restricted tool processes."""
import ctypes
import datetime
import errno
import json
import os
import platform
import resource
import shutil
import struct
import subprocess
import sys

MIB = 1024 * 1024
MAX_PIXELS = 40_000_000
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx"}
MP4_BRANDS = {b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"M4V "}
VIDEO_FILTERS = {"h264": "6", "hevc": "39|40"}
PHOTO_TAGS = [
    "DateTimeOriginal", "CreateDate", "ModifyDate", "OffsetTime", "OffsetTimeOriginal",
    "OffsetTimeDigitized", "SubSecTime", "SubSecTimeOriginal", "SubSecTimeDigitized",
    "Orientation", "ColorSpace", "XResolution", "YResolution", "ResolutionUnit", "ExifImageWidth",
    "ExifImageHeight", "ExposureTime", "FNumber", "ISO", "FocalLength", "Flash", "WhiteBalance",
]
EXTRA_PATHS = [sys.argv[2], sys.argv[3], os.path.join(os.path.dirname(sys.argv[3]), "package.json"), *os.environ.get("PERL5LIB", "").split(os.pathsep)]


class Rejected(Exception):
    pass


def memory_file():
    return os.fdopen(os.memfd_create("herbarium-media", os.MFD_CLOEXEC), "w+b", buffering=0)


def restrict_tool(output_limit, address_space, tool):
    """Landlock grants read/execute access to tools and libraries only. All I/O uses inherited fds."""
    if platform.machine() not in ("x86_64", "aarch64"):
        raise RuntimeError("Unsupported media worker architecture")
    libc = ctypes.CDLL(None, use_errno=True)

    def checked(result):
        if result < 0:
            raise OSError(ctypes.get_errno(), "Media sandbox unavailable")
        return result

    abi = checked(libc.syscall(444, None, 0, 1))
    if abi < 3:
        raise RuntimeError("Landlock ABI 3 is required")
    handled_fs = (1 << 15) - 1
    checked(libc.prctl(38, 1, 0, 0, 0))  # PR_SET_NO_NEW_PRIVS
    network = 3 if abi >= 4 else 0  # Deny TCP bind and connect when the kernel supports it.
    rule = ctypes.create_string_buffer(struct.pack("=QQ", handled_fs, network))
    ruleset = checked(libc.syscall(444, rule, 16, 0))
    try:
        paths = [
            "/bin", "/lib", "/lib64", "/usr/bin", "/usr/lib", "/usr/lib64", "/usr/share",
            "/usr/local/bin", "/usr/local/lib", "/etc/ld.so.cache", "/dev/null", tool,
            *EXTRA_PATHS,
        ]
        for path in paths:
            if not path or not os.path.exists(path):
                continue
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                access = 13 if os.path.isdir(path) else 5  # execute, read file, read directory
                attr = ctypes.create_string_buffer(struct.pack("=Qi", access, fd))
                checked(libc.syscall(445, ruleset, 1, attr, 0))
            finally:
                os.close(fd)
        checked(libc.syscall(446, ruleset, 0))
    finally:
        os.close(ruleset)

    # The tools need no sockets, ptrace or access to another process's address space.
    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    context = seccomp.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError("Media seccomp context unavailable")
    try:
        for name in (b"socket", b"ptrace", b"process_vm_readv", b"process_vm_writev", b"pidfd_getfd"):
            number = seccomp.seccomp_syscall_resolve_name(name)
            if number >= 0:
                checked(seccomp.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0))
        checked(seccomp.seccomp_load(context))
    finally:
        seccomp.seccomp_release(context)

    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (output_limit, output_limit))
    resource.setrlimit(resource.RLIMIT_AS, (address_space, address_space))
    resource.setrlimit(resource.RLIMIT_CPU, (90, 95))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def run(args, source, destination, limit, address_space=2 * 1024 * MIB):
    tool = shutil.which(args[0])
    if not tool:
        raise RuntimeError("Media tool unavailable")
    source.seek(0)
    subprocess.run(
        [tool, *args[1:]], stdin=source, stdout=destination, stderr=subprocess.DEVNULL,
        check=True, timeout=120, preexec_fn=lambda: restrict_tool(limit, address_space, tool),
    )
    destination.seek(0)


def identify(source):
    source.seek(0)
    prefix = source.read(64)
    if prefix.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(prefix) >= 16 and prefix[4:8] == b"ftyp":
        size = int.from_bytes(prefix[:4], "big")
        if size < 16 or size > len(prefix) or size % 4:
            raise Rejected()
        brands = {prefix[8:12], *(prefix[i:i + 4] for i in range(16, size, 4))}
        if brands & HEIC_BRANDS:
            return "image/heic"
        if prefix[8:12] == b"qt  ":
            return "video/quicktime"
        if brands & MP4_BRANDS:
            return "video/mp4"
    raise Rejected()


def photo_metadata(source):
    with memory_file() as metadata:
        run([
            "exiftool", "-config", "", "-j", "-n", "-FileType", "-DateTimeOriginal", "-CreateDate",
            "-Orientation", "-Rotation", "-Composite:GPSLatitude", "-Composite:GPSLongitude", "-",
        ], source, metadata, 64 * 1024)
        return json.load(metadata)[0]


def capture_date(*values):
    for value in values:
        if isinstance(value, str):
            try:
                return datetime.date.fromisoformat(value[:10].replace(":", "-")).isoformat()
            except ValueError:
                pass
    return None


def ffmpeg_input():
    return [
        "ffmpeg", "-hide_banner", "-v", "error", "-nostdin", "-protocol_whitelist", "fd", "-f", "mov",
        "-enable_drefs", "0", "-threads", "2", "-max_pixels", str(MAX_PIXELS), "-fd", "0", "-i", "fd:",
        "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_metadata:c", "-1", "-map_chapters", "-1",
    ]


def clean_image(source, original, preview, thumbnail, mime, limit):
    metadata = photo_metadata(source)
    if metadata.get("FileType") != {"image/jpeg": "JPEG", "image/png": "PNG", "image/heic": "HEIC"}[mime]:
        raise Rejected()
    run([
        "exiftool", "-config", "", "-o", "-", "-all=", "-Trailer:all=", "-tagsFromFile", "@",
        "-ICC_Profile", *(f"-EXIF:{tag}" for tag in PHOTO_TAGS), "-",
    ], source, original, limit)
    if identify(original) != mime:
        raise Rejected()
    with memory_file() as decoded:
        pixels = original
        orientation = 1
        if mime == "image/heic":
            run([
                *ffmpeg_input(), "-map", "0:v:0", "-frames:v", "1", "-c:v", "png", "-threads", "2", "-f",
                "image2pipe", "-fd", "1", "fd:",
            ], original, decoded, 160 * MIB)
            pixels = decoded
            if not metadata.get("Rotation") and metadata.get("Orientation") in range(1, 9):
                orientation = metadata["Orientation"]
        for width, output in [(1600, preview), (400, thumbnail)]:
            run([
                sys.argv[2], "--openssl-config=/dev/null", "--max-old-space-size=384", "-e", sys.argv[4],
                str(width), sys.argv[3], str(orientation),
            ], pixels, output, 16 * MIB, 16 * 1024 * MIB)
    return {
        "captureDate": capture_date(metadata.get("DateTimeOriginal"), metadata.get("CreateDate")),
        "lat": metadata.get("GPSLatitude"), "lon": metadata.get("GPSLongitude"),
    }


def clean_video(source, original, preview, thumbnail, mime, limit):
    with memory_file() as metadata:
        run([
            "ffprobe", "-v", "error", "-protocol_whitelist", "fd", "-f", "mov", "-fd", "0", "-i", "fd:",
            "-show_entries", "stream=codec_name,width,height,codec_type:stream_disposition=attached_pic:format_tags=creation_time",
            "-of", "json",
        ], source, metadata, 64 * 1024)
        info = json.load(metadata)
    video = [stream for stream in info.get("streams", [])
             if stream["codec_type"] == "video" and not stream.get("disposition", {}).get("attached_pic")]
    if not video or any(item.get("codec_name") not in VIDEO_FILTERS or
                        not 0 < item.get("width", 0) * item.get("height", 0) <= MAX_PIXELS for item in video):
        raise Rejected()
    creation = info.get("format", {}).get("tags", {}).get("creation_time", "")
    date = capture_date(creation)
    safe_creation = []
    if date:
        try:
            instant = datetime.datetime.fromisoformat(creation)
            safe_creation = ["-metadata", f"creation_time={instant.isoformat()}"]
        except ValueError:
            pass
    # Strip supplementary bitstream messages as well as container metadata and tracks.
    filters = [arg for index, stream in enumerate(video) for arg in
               (f"-bsf:v:{index}", f"filter_units=remove_types={VIDEO_FILTERS[stream['codec_name']]}")]
    run([
        *ffmpeg_input(), "-map", "0:V", "-map", "0:a?", "-c", "copy", *safe_creation, *filters,
        "-f", "mov" if mime == "video/quicktime" else "mp4", "-fd", "1", "fd:",
    ], source, original, limit)
    if identify(original) != mime:
        raise Rejected()
    scale = "scale=w='min(960,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    run([
        *ffmpeg_input(), "-map", "0:V:0", "-map", "0:a:0?", "-filter_threads", "2", "-vf", scale,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac",
        "-f", "mp4", "-fd", "1", "fd:",
    ], original, preview, limit)
    run([
        *ffmpeg_input(), "-map", "0:V:0", "-frames:v", "1", "-filter_threads", "2", "-vf",
        "scale=w='min(400,iw)':h='min(400,ih)':force_original_aspect_ratio=decrease", "-c:v", "mjpeg",
        "-threads", "2", "-q:v", "3", "-f", "image2pipe", "-fd", "1", "fd:",
    ], preview, thumbnail, 2 * MIB)
    return {"captureDate": date, "lat": None, "lon": None}


def main():
    limit = int(sys.argv[1])
    with memory_file() as source, memory_file() as original, memory_file() as preview, memory_file() as thumb:
        while block := sys.stdin.buffer.read(256 * 1024):
            if source.tell() + len(block) > limit:
                raise Rejected()
            source.write(block)
        mime = identify(source)
        is_video = mime.startswith("video/")
        clean = clean_video if is_video else clean_image
        metadata = clean(source, original, preview, thumb, mime, limit + MIB)
        source.close()
        metadata["contentType"] = mime
        files = (original, preview, thumb)
        metadata["sizes"] = [os.fstat(file.fileno()).st_size for file in files]
        if any(size == 0 for size in metadata["sizes"]):
            raise Rejected()
        with os.fdopen(3, "w", encoding="utf-8") as status:
            json.dump(metadata, status, allow_nan=False)
        for file in files:
            file.seek(0)
            shutil.copyfileobj(file, sys.stdout.buffer, length=256 * 1024)
            file.close()


try:
    main()
except (Rejected, subprocess.CalledProcessError, subprocess.TimeoutExpired):
    sys.exit(3)
except Exception:
    sys.exit(4)
