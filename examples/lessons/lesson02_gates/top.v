// Урок 2: шесть логических вентилей на двух кнопках.
// Чисто комбинационная схема: нет такта, нет памяти.
module top (
    input  wire       btn_s1,   // кнопка S1, вывод 88, нажата = 1
    input  wire       btn_s2,   // кнопка S2, вывод 87, нажата = 1
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // Короткие имена для входов: это просто провода.
    wire a, b;
    assign a = btn_s1;
    assign b = btn_s2;

    // f — «логические» результаты: 1 значит «светодиод должен гореть».
    wire [5:0] f;
    assign f[0] = ~a;          // LED0: NOT S1
    assign f[1] = a & b;       // LED1: AND
    assign f[2] = a | b;       // LED2: OR
    assign f[3] = a ^ b;       // LED3: XOR
    assign f[4] = ~(a & b);    // LED4: NAND
    assign f[5] = ~(a | b);    // LED5: NOR

    // Светодиоды горят по нулю, поэтому переворачиваем все шесть битов разом.
    assign led = ~f;
endmodule
