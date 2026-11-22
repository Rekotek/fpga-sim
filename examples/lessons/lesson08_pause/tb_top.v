// Тестбенч задания «Дыхание с паузой». После каждого тика сверяем duty
// и состояние с моделью: вдох 0 → 255, выдох 255 → 0, пауза 128 тиков, снова вдох.
`timescale 1ns / 100ps

module tb_top;
    reg        clk = 1'b0;
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 2560: LAST = 2560 / 256 - 1 = 9, тик каждые 10 тактов.
    top #(.CLK_HZ(2560)) dut (.clk(clk), .led(led));

    integer   k, want_duty = 0, want_p = 0, errors = 0;
    reg [1:0] want_state = 2'd0;      // модель: 0 = вдох, 1 = выдох, 2 = пауза

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("  тик  duty  ожидали  state  ожидали");
        for (k = 1; k <= 1300; k = k + 1) begin
            // Модель автомата.
            if      (want_state == 0 && want_duty == 255)  begin want_state = 1; want_p = 0; end
            else if (want_state == 1 && want_duty == 0)    begin want_state = 2; want_p = 0; end
            else if (want_state == 2 && want_p == 127)     begin want_state = 0; want_p = 0; end
            else want_p = want_p + 1;
            if (want_state == 0) want_duty = want_duty + 1;
            if (want_state == 1) want_duty = want_duty - 1;

            @(negedge dut.tick);  @(negedge clk);       // тик прошёл
            if (dut.duty !== want_duty || dut.state !== want_state) errors = errors + 1;
            if (k == 1 || k == 255 || k == 256 || (k >= 510 && k <= 511)
                || (k >= 638 && k <= 640) || k == 1300)
                $display(" %4d   %3d     %3d      %0d       %0d",
                         k, dut.duty, want_duty, dut.state, want_state);
        end
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
