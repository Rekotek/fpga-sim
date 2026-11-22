// Тестбенч урока 8: «дыхание». После каждого тика сверяем duty и состояние
// с моделью «треугольник»: 0 → 255 → 0 → 255 … Два полных вдоха-выдоха.
`timescale 1ns / 100ps

module tb_top;
    reg        clk = 1'b0;
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 2560: LAST = 2560 / 256 - 1 = 9, тик каждые 10 тактов.
    top #(.CLK_HZ(2560)) dut (.clk(clk), .led(led));

    integer   k, want_duty = 0, errors = 0;
    reg       want_down = 1'b0;      // модель: 1 = выдох

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("  тик  duty  ожидали  выдох  ожидали");
        for (k = 1; k <= 1020; k = k + 1) begin
            // Модель: разворот на 255 и на 0, иначе шаг в ту же сторону.
            if (!want_down && want_duty == 255) want_down = 1'b1;
            else if (want_down && want_duty == 0) want_down = 1'b0;
            want_duty = want_down ? want_duty - 1 : want_duty + 1;

            @(negedge dut.tick);  @(negedge clk);       // тик прошёл
            if (dut.duty !== want_duty || dut.state !== want_down) errors = errors + 1;
            // Печатаем только начало, вершины и низы треугольника.
            if (k <= 2 || (k >= 254 && k <= 257) || (k >= 509 && k <= 511) || k == 1020)
                $display(" %4d   %3d     %3d      %b       %b",
                         k, dut.duty, want_duty, dut.state, want_down);
        end
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
