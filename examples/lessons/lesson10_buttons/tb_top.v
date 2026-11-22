// Тестбенч задания «Цвет кнопками»: жмём S1 и S2 с дребезгом,
// после каждого нажатия ловим кадр WS2812 и сверяем цвет.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;

    reg  clk = 1'b0;
    reg  s1 = 1'b0, s2 = 1'b0;
    wire ws;

    always #18.5 clk = ~clk;              // 27 МГц

    // Опрос кнопок 1 000 000 раз в секунду: тик каждые 27 тактов (1 мкс).
    top #(.DB_HZ(1_000_000)) dut (.clk(clk), .btn_s1(s1), .btn_s2(s2), .ws2812(ws));

    // ---------- Приёмник WS2812 ----------
    reg  [23:0] grb, last = 24'h0;
    integer     nb = 0, frames = 0, errors = 0;
    realtime    t_rise;

    always begin
        @(posedge ws);
        t_rise = $realtime;
        @(negedge ws);
        grb = {grb[22:0], ($realtime - t_rise > 600.0)};
        nb  = nb + 1;
        if (nb == 24) begin
            nb = 0;
            frames = frames + 1;
            last = grb;
        end
    end

    // Кнопка i (1 = S1, 2 = S2) в положение v, с дребезгом (урок 6).
    task move (input integer i, input v);
        integer j;
        begin
            for (j = 0; j < BOUNCE; j = j + 1) begin
                if (i == 1) s1 = v; else s2 = v;   #60;
                if (i == 1) s1 = ~v; else s2 = ~v; #40;
            end
            if (i == 1) s1 = v; else s2 = v;
            #5000;                        // 5 мкс: больше нескольких тиков опроса
        end
    endtask

    // Нажать и отпустить кнопку i, дождаться двух кадров, сверить цвет.
    task press (input integer i, input [23:0] want);
        integer f0;
        begin
            move(i, 1'b1);  move(i, 1'b0);
            f0 = frames;
            wait (frames == f0 + 2);
            $display("  S%0d    %h %h %h    %h %h %h", i,
                     last[23:16], last[15:8], last[7:0],
                     want[23:16], want[15:8], want[7:0]);
            if (last !== want) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        wait (frames == 1);
        $display("кнопка  G  R  B    ожидали");
        $display("  -     %h %h %h    00 28 00", last[23:16], last[15:8], last[7:0]);
        if (last !== 24'h00_28_00) errors = errors + 1;
        press(1, 24'h28_28_00);           // жёлтый, 40
        press(2, 24'h50_50_00);           // жёлтый, 80
        press(1, 24'h50_00_00);           // зелёный
        press(2, 24'h78_00_00);           // 120
        press(2, 24'ha0_00_00);           // 160
        press(2, 24'h28_00_00);           // по кругу: снова 40
        press(1, 24'h28_00_28);           // голубой
        press(1, 24'h00_00_28);           // синий
        press(1, 24'h00_28_28);           // пурпурный
        press(1, 24'h28_28_28);           // белый
        press(1, 24'h00_28_00);           // по кругу: красный
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
