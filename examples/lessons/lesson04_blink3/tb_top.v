// Тестбенч blink3: за 100 тактов «игрушечной» частоты 20 Гц
// LED0 должен переключиться 10 раз, LED1 — 20, LED2 — 50.
`timescale 1ns / 100ps

module tb_top;
    localparam integer SIM_HZ = 20;   // HALF0 = 9, HALF1 = 4, HALF2 = 1

    reg        clk = 1'b0;
    wire [2:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    top #(.CLK_HZ(SIM_HZ)) dut (.clk(clk), .led(led));

    integer flips0 = 0, flips1 = 0, flips2 = 0;
    always @(led[0]) if ($realtime > 0) flips0 = flips0 + 1;
    always @(led[1]) if ($realtime > 0) flips1 = flips1 + 1;
    always @(led[2]) if ($realtime > 0) flips2 = flips2 + 1;

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        #(37 * 100 + 1);              // 100 тактов и чуть-чуть
        $display("Переключений за 100 тактов: LED0 %0d, LED1 %0d, LED2 %0d",
                 flips0, flips1, flips2);
        if (flips0 == 10 && flips1 == 20 && flips2 == 50) $display("ТЕСТ ПРОЙДЕН");
        else $display("ТЕСТ НЕ ПРОЙДЕН: ожидали 10, 20 и 50");
        $finish;
    end
endmodule
