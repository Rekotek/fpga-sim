// Тестбенч примера shift_chain. Ожидаемый вывод: «PASS: 6 checks», код завершения 0.
//
// Обе цепочки получают единицу на вход и разрешение сдвига на каждом такте. Верная цепочка
// (chain_good, «<=») продвигает единицу на один разряд за такт: 001, 011, 111. Цепочка
// с ошибкой (chain_bad, «=») заполняется за один такт: 111. На осциллограмме это видно
// по сигналам good и bad.
`timescale 1ns / 1ps
module tb_top;
    reg        clk = 0;
    reg        en = 0;
    reg        d = 0;
    wire [2:0] good;
    wire [2:0] bad;
    integer    checks = 0;
    integer    errors = 0;

    chain_good u_good (.clk(clk), .en(en), .d(d), .q(good));
    chain_bad  u_bad  (.clk(clk), .en(en), .d(d), .q(bad));

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

        // Без разрешения сдвига цепочки стоят.
        d = 1;
        @(negedge clk);
        check(good === 3'b000 && bad === 3'b000, "chains hold without enable");

        en = 1;
        @(negedge clk);
        check(good === 3'b001, "good chain: one stage after the first cycle");
        check(bad === 3'b111, "bad chain: all stages after the first cycle");
        @(negedge clk);
        check(good === 3'b011, "good chain: two stages after the second cycle");
        @(negedge clk);
        check(good === 3'b111, "good chain: three stages after the third cycle");

        // Ноль на входе уходит из цепочки с ошибкой так же за один такт.
        d = 0;
        @(negedge clk);
        check(good === 3'b110 && bad === 3'b000, "zero enters both chains");

        if (errors == 0) $display("PASS: %0d checks", checks);
        else $display("FAIL: %0d of %0d checks", errors, checks);
        $finish;
    end
endmodule
