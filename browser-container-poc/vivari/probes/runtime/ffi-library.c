#include <stdint.h>
#include <stdlib.h>
#include <stddef.h>

void *ffi_alloc(uint32_t n) { return malloc(n); }
void ffi_free(void *p, uint32_t n) { (void)n; free(p); }
uint32_t mutate(uint8_t *p, uint32_t n) {
  uint32_t sum = 0;
  for (uint32_t i = 0; i < n; i++) sum += ++p[i];
  return sum;
}
static uint8_t *retained;
static uint8_t result[4] = {5, 6, 7, 8};
uint8_t *result_pointer(void) { return result; }
void retain(uint8_t *p) { retained = p; }
uint32_t retained_value(void) { return *retained; }
uint32_t call_callback(uint32_t (*cb)(uint8_t *, uint32_t), uint8_t *p) {
  *p = 40;
  return cb(p, 2) + *p;
}
uint32_t grow(void) { return __builtin_wasm_memory_grow(0, 2); }
uint64_t wide(uint64_t value) { return value + 1; }
float fractional(float value) { return value * 2; }
// A pointer-containing wasm32 struct. The caller explicitly uses the artifact
// layout, proving nested offsets without pretending a native64 packer is portable.
struct record { uint8_t *data; uint32_t size; };
uint32_t record_sum(struct record *r) {
  uint32_t sum = 0;
  for (uint32_t i = 0; i < r->size; i++) sum += r->data[i];
  return sum;
}
