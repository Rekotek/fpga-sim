// Тестбенч урока 8: шесть уровней яркости. Считаем, сколько тактов
// из 1024 (четыре периода ШИМ) горит каждый светодиод, и сверяем с 4 × duty.
`timescale 1ns / 100ps

module tb_top;
    reg        clk = 1'b0;
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    top dut (.clk(clk), .led(led));   // делителя нет — параметр не нужен

    wire [5:0] on = ~led;             // 1 = горит
    integer    ones [0:5];            // сколько тактов горел каждый светодиод
    reg  [7:0] want [0:5];            // заданный duty
    integer    i, t, errors = 0;

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        want[0] = 255;  want[1] = 128;  want[2] = 64;
        want[3] = 32;   want[4] = 16;   want[5] = 8;
        for (i = 0; i < 6; i = i + 1) ones[i] = 0;

        // 1024 такта: на каждом спаде clk смотрим на все шесть светодиодов.
        for (t = 0; t < 1024; t = t + 1) begin
            @(negedge clk);
            for (i = 0; i < 6; i = i + 1)
                if (on[i]) ones[i] = ones[i] + 1;
        end

        $display("LED  duty  горел из 1024  ожидали  доля");
        for (i = 0; i < 6; i = i + 1) begin
            $display(" %0d    %3d      %4d         %4d   %5.1f %%",
                     i, want[i], ones[i], 4 * want[i], 100.0 * ones[i] / 1024);
            if (ones[i] != 4 * want[i]) errors = errors + 1;
        end

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
