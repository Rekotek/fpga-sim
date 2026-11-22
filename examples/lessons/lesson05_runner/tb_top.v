// Тестбенч урока 5: бегущий огонь. Проверяем каждый шаг двух полных кругов.
`timescale 1ns / 100ps

module tb_top;
    reg        clk = 1'b0;
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 24: LAST = 24 / 8 - 1 = 2, тик каждые 3 такта.
    top #(.CLK_HZ(24)) dut (.clk(clk), .led(led));

    wire [5:0] on = ~led;             // 1 = светодиод горит
    reg  [5:0] expected = 6'b000001;  // где должен быть огонёк
    integer    step, errors = 0;

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("шаг  LED5..LED0  ожидали");
        #1 $display(" 0     %b     %b", on, expected);   // #1: дать начальным значениям появиться

        for (step = 1; step <= 12; step = step + 1) begin
            repeat (3) @(posedge clk);                // один шаг = 3 такта
            @(negedge clk);                           // полтакта спустя всё устоялось
            expected = {expected[4:0], expected[5]};  // следующее ожидаемое положение
            $display("%2d     %b     %b", step, on, expected);
            if (on !== expected) errors = errors + 1;
        end

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
