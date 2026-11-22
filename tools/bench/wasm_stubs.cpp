// Stubs for Emscripten. The Emscripten libc headers declare thread-to-core affinity
// (and the CPU_ZERO macro, by which Verilator picks the "as in Linux" branch),
// but the libc has no such functions, and linking the Verilator support files fails.
// The FPGA SIM core runs in one thread, so the functions answer "not supported".
#include <pthread.h>
#include <sched.h>

#include <cerrno>

extern "C" {

int pthread_getaffinity_np(pthread_t, size_t, cpu_set_t*) { return ENOSYS; }
int pthread_setaffinity_np(pthread_t, size_t, const cpu_set_t*) { return ENOSYS; }
int sched_getcpu(void) { return 0; }

}  // extern "C"
