#include <errno.h>
#include <fcntl.h>
#include <unistd.h>

// Independent libc consumer: the renderer-specific ABI is not involved.
int probe(void) {
    if (pwrite(1, "BAD", 3, 0) != -1 || errno != ESPIPE) return 1;
    int fd = open("/workspace/wasi-libc.txt", O_CREAT | O_TRUNC | O_RDWR, 0600);
    if (fd < 0) return 2;
    int result = 0;
    if (write(fd, "abcd", 4) != 4) result = 3;
    if (!result && pwrite(fd, "XY", 2, 1) != 2) result = 4;
    if (!result && lseek(fd, 0, SEEK_CUR) != 4) result = 5;
    if (close(fd) != 0 && !result) result = 6;
    return result;
}
