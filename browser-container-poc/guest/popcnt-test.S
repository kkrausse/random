# Run enough iterations to exercise QEMU-Wasm's hot-block compiler, not only its interpreter.
.global _start
.text
_start:
    mov $100000, %ecx
again:
    mov $-1, %rax
    popcnt %rax, %rdx
    cmp $64, %rdx
    jne fail
    popcnt %eax, %edx
    cmp $32, %rdx
    jne fail
    movabs $0x8000000100000000, %rax
    popcnt %rax, %rax
    cmp $2, %rax
    jne fail
    movabs $0xaaaaaaaa55555555, %rax
    popcnt %eax, %eax
    cmp $16, %rax
    jne fail
    xor %eax, %eax
    popcnt %rax, %rdx
    test %rdx, %rdx
    jne fail
    dec %ecx
    jnz again
    mov $1, %eax
    mov $1, %edi
    lea passed(%rip), %rsi
    mov $passed_end-passed, %edx
    syscall
    xor %edi, %edi
    jmp exit
fail:
    mov $1, %edi
exit:
    mov $60, %eax
    syscall
.section .rodata
passed:
    .ascii "POPCNT32/64: 100000 iterations passed\n"
passed_end:
.section .note.GNU-stack,"",@progbits
