// Тестбенч примера blink3. Ожидаемый вывод: «PASS: 8 checks», код завершения 0.
//
// Счётчики схемы считают до миллионов тактов, поэтому тестбенч ставит каждый счётчик
// за два такта до границы и проверяет: на границе счётчик обнуляется, а его светодиод
// переключается. Светодиоды led[3..5] погашены всегда (единица на выводе).
`timescale 1ns / 1ps
module tb_top;
    localparam integer CLK_HZ = 27_000_000;

    reg        clk = 0;
    wire [5:0] led;
    integer    checks = 0;
    integer    errors = 0;

    top dut (.clk(clk), .led(led));

    always #18.519 clk = ~clk;  // 27 МГц

    task check(input ok, input [255:0] name);
        begin
            checks = checks + 1;
            if (!ok) begin
                errors = errors + 1;
                $display("FAIL: %0s at %0t", name, $time);
            end
        end
    endtask

    initial begin
        $dumpfile("dump.vcd");
        $dumpvars(0, tb_top);

        // После включения все светодиоды погашены (единица на выводе).
        @(negedge clk);
        check(led === 6'b111_111, "led after power-on");

        // Каждый счётчик — за два такта до своей границы.
        dut.cnt_a = CLK_HZ / 2 - 2;
        dut.cnt_b = CLK_HZ / 4 - 2;
        dut.cnt_c = CLK_HZ / 8 - 2;
        @(negedge clk);
        check(led === 6'b111_111, "led one cycle before the limit");
        @(negedge clk);
        check(led === 6'b111_000, "all three leds toggle at the limit");
        check(dut.cnt_a == 0, "cnt_a wraps to zero");
        check(dut.cnt_b == 0, "cnt_b wraps to zero");
        check(dut.cnt_c == 0, "cnt_c wraps to zero");

        // Следующая граница самого быстрого счётчика: led[2] гаснет, остальные горят.
        dut.cnt_c = CLK_HZ / 8 - 1;
        @(negedge clk);
        check(led === 6'b111_100, "only led[2] toggles on its own period");
        repeat (4) @(negedge clk);
        check(dut.cnt_a == 5, "cnt_a counts every cycle");

        if (errors == 0) $display("PASS: %0d checks", checks);
        else $display("FAIL: %0d of %0d checks", errors, checks);
        $finish;
    end
endmodule
